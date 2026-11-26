import {
  formatMoney,
  parseAmount,
  ruleInputSchema,
  ruleMatches,
  type ReviewChanges,
} from "@cash-scout/domain";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Group,
  Pagination,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useNameOf,
  usePaymentTypeOptions,
  useReference,
  useSubCategoryOptions,
  type Reference,
} from "../reference";
import { QuickCreate, WithCreate, type Creatable } from "./QuickCreate";
import { draftOf, RuleForm } from "./Rules";
import {
  useApplyRules,
  useBatch,
  useImportBatch,
  useReviewLines,
  useRules,
  useUndoImport,
  type BatchDetail,
  type BatchLine,
  type MatchedEntry,
  type Rule,
} from "../statements";
import { DataTable } from "../table";

const PAGE = 50;
const filters = ["review", "validated", "ignored", "imported", "all"] as const;
type Filter = (typeof filters)[number];
const filterLabels = {
  review: "statements.review.filterReview",
  validated: "statements.review.filterValidated",
  ignored: "statements.review.filterIgnored",
  imported: "statements.review.filterImported",
  all: "statements.review.filterAll",
} as const;

type Change = ReviewChanges["changes"][number];

function ErrorAlert({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  return error ? <Alert color="red">{t("common.error", { message: error.message })}</Alert> : null;
}

/** The lines of an import batch: decide what each one is, then import. */
export function BatchReview({ bookId, batchId }: { bookId: string; batchId: string }) {
  const reference = useReference(bookId);
  const batch = useBatch(bookId, batchId);
  if (!batch.data || !reference.data) {
    return <ErrorAlert error={batch.error ?? reference.error} />;
  }
  return <Review bookId={bookId} batch={batch.data} reference={reference.data} />;
}

function Review({
  bookId,
  batch,
  reference,
}: {
  bookId: string;
  batch: BatchDetail;
  reference: Reference;
}) {
  const { t } = useTranslation();
  const review = useReviewLines(bookId, batch.id);
  const rules = useRules(bookId);
  const apply = useApplyRules(bookId, batch.id);
  const [ruleFor, setRuleFor] = useState<BatchLine | null>(null);
  // The line just classified by hand, for which a rule is proposed.
  const [suggested, setSuggested] = useState<string | null>(null);
  // What is being created, and what to do with it once made.
  const [creating, setCreating] = useState<{
    kind: Creatable;
    initialName?: string;
    use: (id: string) => void;
  } | null>(null);
  // The rules can be tried again on the lines still to review.
  const open = batch.lines.filter((l) => l.status === "review" && !l.entry).length;
  const ruleOf = (line: BatchLine) => rules.data?.find((r) => r.id === line.ruleId);
  const [filter, setFilter] = useState<Filter>(() =>
    batch.lines.some((l) => l.status === "review") ? "review" : "all",
  );
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const options = useSubCategoryOptions(reference);
  const payments = usePaymentTypeOptions(reference);
  const nameOf = useNameOf(reference.defaultLanguage);
  // A transfer made from a line: the other accounts in its currency, and the sub-category to use.
  const transfers = {
    accounts: reference.accounts
      .filter((a) => !a.archived && a.id !== batch.accountId && a.currency === batch.currency)
      .map((a) => ({ value: a.id, label: nameOf(a.names) })),
    subCategoryId:
      reference.subCategories.find((sub) => {
        const cat = reference.categories.find((c) => c.id === sub.categoryId);
        const nat = reference.natures.find((n) => n.id === cat?.natureId);
        return !sub.archived && !cat?.archived && nat?.transfer;
      })?.id ?? null,
  };

  const count = (f: Filter) =>
    f === "all" ? batch.lines.length : batch.lines.filter((l) => l.status === f).length;
  const shown = batch.lines.filter((l) => filter === "all" || l.status === filter);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const current = Math.min(page, pages);
  const visible = shown.slice((current - 1) * PAGE, current * PAGE);
  const selectable = visible.filter((l) => l.status !== "imported");
  // A line decided elsewhere (imported) drops out of the selection.
  const chosen = batch.lines.filter((l) => selected.has(l.id) && l.status !== "imported");

  const matches = batch.lines.filter(
    (l) => l.status === "review" && !l.duplicate && l.candidates[0]?.amount === l.amount,
  );
  const seen = batch.lines.filter((l) => l.status === "review" && l.duplicate);
  // A rule proposed something: a sub-category to take, or ignoring the line.
  const proposed = batch.lines.filter(
    (l) =>
      l.status === "review" &&
      !l.duplicate &&
      l.candidates.length === 0 &&
      l.ruleId !== null &&
      (l.subCategoryId !== null || ruleOf(l)?.ignore === true),
  );

  const save = (changes: Change[]) => review.mutate(changes);
  /** A change to one line; classifying it by hand is the moment to offer a rule. */
  const saveLine = (line: BatchLine, change: Omit<Change, "id">) =>
    review.mutate([{ id: line.id, ...change }], {
      onSuccess: () => {
        // Not for a transfer: a rule cannot make one.
        const filed = change.subCategoryId && !change.transferAccountId;
        if (filed && !line.ruleId && (line.counterparty || line.label)) {
          setSuggested(line.id);
        }
      },
    });
  const saveChosen = (change: Omit<Change, "id">) => {
    save(chosen.map((l) => ({ id: l.id, ...change })));
    setSelected(new Set());
  };
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setSelected(next);
  };

  return (
    <Stack>
      <Group justify="space-between">
        <SegmentedControl
          value={filter}
          onChange={(value) => {
            setFilter(value as Filter);
            setPage(1);
            setSelected(new Set());
          }}
          data={filters.map((f) => ({
            value: f,
            label: t(filterLabels[f], { count: count(f) }),
          }))}
          style={{ maxWidth: "100%", overflowX: "auto" }}
        />
        <Group gap="xs">
          {matches.length > 0 && (
            <Button
              variant="light"
              size="compact-md"
              onClick={() => save(matches.map((l) => ({ id: l.id, entryId: l.candidates[0]!.id })))}
            >
              {t("statements.review.acceptMatches", { count: matches.length })}
            </Button>
          )}
          {(rules.data?.length ?? 0) > 0 && open > 0 && (
            <Button
              variant="default"
              size="compact-md"
              loading={apply.isPending}
              onClick={() => apply.mutate()}
            >
              {t("statements.review.applyRules")}
            </Button>
          )}
          {proposed.length > 0 && (
            <Button
              variant="light"
              color="grape"
              size="compact-md"
              onClick={() =>
                save(
                  proposed.map((l) =>
                    l.subCategoryId
                      ? { id: l.id, subCategoryId: l.subCategoryId }
                      : { id: l.id, status: "ignored" },
                  ),
                )
              }
            >
              {t("statements.review.acceptRules", { count: proposed.length })}
            </Button>
          )}
          {seen.length > 0 && (
            <Button
              variant="light"
              color="orange"
              size="compact-md"
              onClick={() => save(seen.map((l) => ({ id: l.id, status: "ignored" })))}
            >
              {t("statements.review.ignoreSeen", { count: seen.length })}
            </Button>
          )}
        </Group>
      </Group>

      {chosen.length > 0 && (
        <Paper withBorder p="xs">
          <Group>
            <Text size="sm">{t("statements.review.selected", { count: chosen.length })}</Text>
            <Group gap={4} wrap="nowrap">
              <Select
                aria-label={t("statements.review.forSelected")}
                placeholder={t("statements.review.forSelected")}
                searchable
                data={options}
                value={null}
                onChange={(value) => value && saveChosen({ subCategoryId: value })}
                w={280}
              />
              <ActionIcon
                variant="default"
                size="input-sm"
                aria-label={t("reference.newSubCategory")}
                title={t("reference.newSubCategory")}
                onClick={() =>
                  setCreating({
                    kind: "subCategory",
                    use: (id) => saveChosen({ subCategoryId: id }),
                  })
                }
              >
                +
              </ActionIcon>
            </Group>
            <Button
              variant="default"
              size="compact-md"
              onClick={() => saveChosen({ status: "ignored" })}
            >
              {t("statements.review.ignore")}
            </Button>
            <Button
              variant="default"
              size="compact-md"
              onClick={() => saveChosen({ status: "review" })}
            >
              {t("statements.review.restore")}
            </Button>
          </Group>
        </Paper>
      )}

      <ErrorAlert error={review.error} />

      {visible.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t("statements.review.none")}
        </Text>
      ) : (
        <DataTable minWidth={820} highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={36}>
                <Checkbox
                  aria-label={t("statements.review.selectAll")}
                  disabled={selectable.length === 0}
                  checked={selectable.length > 0 && selectable.every((l) => selected.has(l.id))}
                  onChange={(e) =>
                    toggle(
                      selectable.map((l) => l.id),
                      e.currentTarget.checked,
                    )
                  }
                />
              </Table.Th>
              <Table.Th>{t("statements.date")}</Table.Th>
              <Table.Th>{t("statements.label")}</Table.Th>
              <Table.Th ta="right">{t("statements.amount")}</Table.Th>
              <Table.Th w={340}>{t("statements.review.decision")}</Table.Th>
              <Table.Th w={110} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visible.map((line) => (
              <Line
                key={line.id}
                line={line}
                currency={batch.currency}
                options={options}
                transfers={transfers}
                forecasts={batch.forecasts}
                payments={payments}
                rule={ruleOf(line)}
                onCreateRule={() => setRuleFor(line)}
                onCreate={(kind) =>
                  setCreating({
                    kind,
                    // The bank's category is often the name wanted; "to categorise" is not.
                    initialName:
                      kind === "subCategory" && !/categori/i.test(line.bankCategory)
                        ? line.bankCategory
                        : undefined,
                    use: (id) =>
                      saveLine(
                        line,
                        kind === "subCategory" ? { subCategoryId: id } : { paymentTypeId: id },
                      ),
                  })
                }
                selected={selected.has(line.id)}
                onSelect={(on) => toggle([line.id], on)}
                onChange={(change) => saveLine(line, change)}
              />
            ))}
          </Table.Tbody>
        </DataTable>
      )}
      {pages > 1 && <Pagination total={pages} value={current} onChange={setPage} />}

      <ImportPanel bookId={bookId} batch={batch} saving={review.isPending} />
      {creating && (
        <QuickCreate
          kind={creating.kind}
          bookId={bookId}
          initialName={creating.initialName}
          onClose={() => setCreating(null)}
          onCreated={creating.use}
        />
      )}
      {ruleFor && (
        <RuleForm
          bookId={bookId}
          initial={draftOf({
            text: ruleFor.counterparty || ruleFor.label,
            subCategoryId: ruleFor.subCategoryId,
            paymentTypeId: ruleFor.paymentTypeId,
            description: ruleFor.description,
          })}
          sample={{
            currency: batch.currency,
            suggestedName: ruleFor.bankCategory,
            lines: batch.lines.filter((l) => l.status === "review"),
          }}
          onClose={() => setRuleFor(null)}
          onSaved={() => {
            setSuggested(null);
            apply.mutate();
          }}
        />
      )}
      <RuleSuggestion
        batch={batch}
        reference={reference}
        lineId={suggested}
        onAccept={(line) => {
          setSuggested(null);
          setRuleFor(line);
        }}
        onDismiss={() => setSuggested(null)}
      />
    </Stack>
  );
}

function Line({
  line,
  currency,
  options,
  transfers,
  forecasts,
  payments,
  rule,
  onCreateRule,
  onCreate,
  selected,
  onSelect,
  onChange,
}: {
  line: BatchLine;
  currency: string;
  options: ReturnType<typeof useSubCategoryOptions>;
  transfers: Transfers;
  forecasts: MatchedEntry[];
  payments: ReturnType<typeof usePaymentTypeOptions>;
  rule: Rule | undefined;
  onCreateRule: () => void;
  onCreate: (kind: Creatable) => void;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onChange: (change: Omit<Change, "id">) => void;
}) {
  const { t, i18n } = useTranslation();
  const imported = line.status === "imported";
  const ignored = line.status === "ignored";
  return (
    <Table.Tr opacity={ignored ? 0.55 : undefined}>
      <Table.Td>
        <Checkbox
          aria-label={t("statements.review.selectLine", { date: line.date })}
          disabled={imported}
          checked={selected && !imported}
          onChange={(e) => onSelect(e.currentTarget.checked)}
        />
      </Table.Td>
      <Table.Td style={{ whiteSpace: "nowrap" }}>{line.date}</Table.Td>
      <Table.Td>
        <Group gap={6} wrap="wrap">
          <Text size="sm" fw={500}>
            {line.counterparty}
          </Text>
          {line.duplicate && (
            <Badge size="xs" color="orange" variant="light">
              {t("statements.duplicate")}
            </Badge>
          )}
        </Group>
        <Text size="xs" c="dimmed" title={line.memo || undefined}>
          {line.label}
        </Text>
        {line.bankCategory && (
          <Text size="xs" c="dimmed" fs="italic">
            {line.bankCategory}
          </Text>
        )}
      </Table.Td>
      <Table.Td
        ta="right"
        c={line.amount.startsWith("-") ? "red" : undefined}
        style={{ whiteSpace: "nowrap" }}
      >
        {formatMoney(parseAmount(line.amount, currency), i18n.language)}
      </Table.Td>
      <Table.Td>
        <Decision
          line={line}
          currency={currency}
          options={options}
          transfers={transfers}
          forecasts={forecasts}
          payments={payments}
          rule={rule}
          onCreateRule={onCreateRule}
          onCreate={onCreate}
          onChange={onChange}
        />
      </Table.Td>
      <Table.Td ta="right">
        {!imported && (
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            onClick={() => onChange({ status: ignored ? "review" : "ignored" })}
          >
            {ignored ? t("statements.review.restore") : t("statements.review.ignore")}
          </Button>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

/** What the line becomes in the journal, and the means to choose it. */
/** What a line needs to become one side of a new transfer. */
interface Transfers {
  accounts: { value: string; label: string }[];
  /** A sub-category of a transfer nature, null when the book has none. */
  subCategoryId: string | null;
}

function Decision({
  line,
  currency,
  options,
  transfers,
  forecasts,
  payments,
  rule,
  onCreateRule,
  onCreate,
  onChange,
}: {
  line: BatchLine;
  currency: string;
  options: ReturnType<typeof useSubCategoryOptions>;
  transfers: Transfers;
  forecasts: MatchedEntry[];
  payments: ReturnType<typeof usePaymentTypeOptions>;
  rule: Rule | undefined;
  onCreateRule: () => void;
  onCreate: (kind: Creatable) => void;
  onChange: (change: Omit<Change, "id">) => void;
}) {
  const { t, i18n } = useTranslation();
  const money = (amount: string) => formatMoney(parseAmount(amount, currency), i18n.language);
  /** Said after an entry whose amount the line would change. */
  const planned = (entry: MatchedEntry) =>
    entry.amount === line.amount
      ? ""
      : ` ${t("statements.review.planned", { amount: money(entry.amount) })}`;
  const named = (entry: MatchedEntry) => ({
    date: entry.date,
    description: entry.transfer
      ? `${entry.description} ${t("statements.review.transfer")}`
      : entry.description,
  });
  if (line.status === "imported") {
    return (
      <Badge color="teal" variant="light">
        {t("statements.review.imported")}
      </Badge>
    );
  }
  if (line.status === "ignored") {
    return (
      <Text size="sm" c="dimmed">
        {t("statements.review.ignored")}
      </Text>
    );
  }
  if (line.entry) {
    return (
      <Group gap={6} wrap="nowrap">
        <Text size="sm">
          {t("statements.review.willReconcile", named(line.entry))}
          {planned(line.entry)}
        </Text>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={t("statements.review.unmatch")}
          onClick={() => onChange({ entryId: null })}
        >
          ✕
        </ActionIcon>
      </Group>
    );
  }
  const suggested = line.description ?? (line.counterparty || line.label);
  const transferAccount = transfers.accounts.find((a) => a.value === line.transferAccountId);
  if (line.transferAccountId) {
    return (
      <Group gap={6} wrap="nowrap">
        <Text size="sm">
          {t(
            line.amount.startsWith("-")
              ? "statements.review.transferTo"
              : "statements.review.transferFrom",
            {
              account: transferAccount?.label ?? "",
            },
          )}
        </Text>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={t("statements.review.unmatch")}
          onClick={() => onChange({ subCategoryId: null })}
        >
          ✕
        </ActionIcon>
      </Group>
    );
  }
  return (
    <Stack gap={4}>
      {line.candidates.slice(0, 3).map((entry, i) => (
        <Button
          key={entry.id}
          variant={i === 0 ? "light" : "subtle"}
          size="compact-sm"
          justify="flex-start"
          h="auto"
          py={2}
          styles={{ label: { whiteSpace: "normal", textAlign: "left" } }}
          onClick={() => onChange({ entryId: entry.id })}
        >
          {t("statements.review.reconcile", named(entry))}
          {planned(entry)}
        </Button>
      ))}
      {forecasts.length > 0 && (
        <Select
          size="xs"
          aria-label={t("statements.review.pickForecast")}
          placeholder={t("statements.review.pickForecast")}
          searchable
          data={forecasts.map((entry) => ({
            value: entry.id,
            label: `${entry.date} · ${money(entry.amount)} · ${entry.description}`,
          }))}
          value={null}
          onChange={(value) => value && onChange({ entryId: value })}
        />
      )}
      <WithCreate label={t("reference.newSubCategory")} onCreate={() => onCreate("subCategory")}>
        <Select
          size="xs"
          aria-label={t("statements.review.subCategory")}
          placeholder={t("statements.review.subCategory")}
          searchable
          clearable
          data={options}
          value={line.subCategoryId}
          onChange={(value) => onChange({ subCategoryId: value })}
        />
      </WithCreate>
      {!line.subCategoryId && transfers.subCategoryId && transfers.accounts.length > 0 && (
        <Select
          size="xs"
          aria-label={t("statements.review.makeTransfer")}
          placeholder={t("statements.review.makeTransfer")}
          searchable
          data={transfers.accounts}
          value={null}
          onChange={(value) =>
            value && onChange({ subCategoryId: transfers.subCategoryId, transferAccountId: value })
          }
        />
      )}
      {rule && (
        <Text size="xs" c="grape">
          {rule.ignore
            ? t("statements.review.ruleIgnores", { name: rule.name })
            : t("statements.review.ruleProposes", { name: rule.name })}
        </Text>
      )}
      {(line.subCategoryId || line.paymentTypeId) && (
        <WithCreate label={t("reference.newPaymentType")} onCreate={() => onCreate("paymentType")}>
          <Select
            size="xs"
            aria-label={t("statements.review.paymentType")}
            placeholder={t("statements.review.paymentType")}
            searchable
            clearable
            data={payments}
            value={line.paymentTypeId}
            onChange={(value) => onChange({ paymentTypeId: value })}
          />
        </WithCreate>
      )}
      {line.subCategoryId && (
        <TextInput
          // Remounted when the saved text changes.
          key={suggested}
          size="xs"
          aria-label={t("statements.review.description")}
          maxLength={500}
          defaultValue={suggested.slice(0, 500)}
          onBlur={(e) => {
            const value = e.currentTarget.value.trim();
            if (value !== suggested.slice(0, 500)) onChange({ description: value || null });
          }}
        />
      )}
      {line.subCategoryId && (
        <Button variant="subtle" size="compact-xs" justify="flex-start" onClick={onCreateRule}>
          {t("statements.review.createRule")}
        </Button>
      )}
    </Stack>
  );
}

/** The import of the validated lines, with the opening balance when it can be told. */
function ImportPanel({
  bookId,
  batch,
  saving,
}: {
  bookId: string;
  batch: BatchDetail;
  saving: boolean;
}) {
  const { t, i18n } = useTranslation();
  const run = useImportBatch(bookId, batch.id);
  const undo = useUndoImport(bookId, batch.id);
  const [ticked, setTicked] = useState<boolean | null>(null);
  const [rate, setRate] = useState("");
  const money = (amount: string) => formatMoney(parseAmount(amount, batch.currency), i18n.language);

  const ready = batch.lines.filter((l) => l.status === "validated").length;
  const opening = batch.opening;
  const changes = opening !== null && opening.proposed !== opening.current;
  const setOpening = changes && (ticked ?? opening.suggested);
  const foreign = batch.currency !== batch.bookCurrency;
  const hasBalance = batch.lines.some((l) => l.balance !== null);
  const toReview = batch.lines.some((l) => l.status === "review");
  const imported = batch.lines.filter((l) => l.status === "imported").length;

  return (
    <Stack gap="xs">
      {run.data && <Alert color="teal">{t("statements.review.done", run.data)}</Alert>}
      {batch.unmatched.length > 0 && batch.lines.some((l) => l.status !== "imported") && (
        <Alert
          color="orange"
          title={t("statements.review.unmatched", { count: batch.unmatched.length })}
        >
          <Text size="sm" mb={4}>
            {t("statements.review.unmatchedHint")}
          </Text>
          {batch.unmatched.slice(0, 10).map((entry) => (
            <Text size="sm" key={entry.id}>
              {entry.date} · {money(entry.amount)} · {entry.description}
            </Text>
          ))}
        </Alert>
      )}
      {undo.data && <Alert color="teal">{t("statements.review.undone", undo.data)}</Alert>}
      <ErrorAlert error={run.error ?? undo.error} />
      {imported > 0 && (
        <Group>
          <Button
            variant="default"
            size="compact-md"
            loading={undo.isPending}
            onClick={() => {
              if (window.confirm(t("statements.review.undoConfirm", { count: imported }))) {
                undo.mutate();
              }
            }}
          >
            {t("statements.review.undo", { count: imported })}
          </Button>
        </Group>
      )}
      {(ready > 0 || changes || (hasBalance && toReview)) && (
        <Paper withBorder p="md">
          <Stack gap="sm">
            {changes && (
              <Checkbox
                checked={setOpening}
                onChange={(e) => setTicked(e.currentTarget.checked)}
                label={t("statements.review.opening", {
                  proposed: money(opening.proposed),
                  current: money(opening.current),
                })}
                description={t("statements.review.openingFrom", {
                  balance: money(opening.balance),
                  date: opening.date,
                })}
              />
            )}
            {hasBalance && toReview && (
              <Text size="sm" c="dimmed">
                {t("statements.review.openingLater")}
              </Text>
            )}
            {foreign && (
              <TextInput
                label={t("statements.review.rate", {
                  currency: batch.currency,
                  bookCurrency: batch.bookCurrency,
                })}
                inputMode="decimal"
                value={rate}
                onChange={(e) => setRate(e.currentTarget.value)}
                w={260}
              />
            )}
            <Group>
              <Button
                loading={run.isPending}
                disabled={saving || (ready === 0 && !setOpening) || (foreign && rate === "")}
                onClick={() => {
                  if (!window.confirm(t("statements.review.importConfirm", { count: ready }))) {
                    return;
                  }
                  run.mutate({
                    setOpening,
                    ...(foreign && { exchangeRate: rate.trim().replace(",", ".") }),
                  });
                }}
              >
                {t("statements.review.import", { count: ready })}
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

/**
 * Offered once a line has been classified by hand: a rule would do the same for the
 * next statements. Says how many other lines to review of this statement it would reach.
 */
function RuleSuggestion({
  batch,
  reference,
  lineId,
  onAccept,
  onDismiss,
}: {
  batch: BatchDetail;
  reference: Reference;
  lineId: string | null;
  onAccept: (line: BatchLine) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const line = batch.lines.find((l) => l.id === lineId);
  // Gone once the line is imported, or a rule took it over.
  if (!line || !line.subCategoryId || line.ruleId || line.status === "imported") return null;

  const text = line.counterparty || line.label;
  const rule = ruleInputSchema.safeParse({ name: text, text, subCategoryId: line.subCategoryId });
  const others = rule.success
    ? batch.lines.filter(
        (l) =>
          l.id !== line.id &&
          l.status === "review" &&
          !l.entry &&
          ruleMatches(rule.data, {
            currency: batch.currency,
            amount: parseAmount(l.amount, batch.currency).minor,
            counterparty: l.counterparty,
            label: l.label,
            memo: l.memo,
            bankCategory: l.bankCategory,
          }),
      ).length
    : 0;
  const sub = reference.subCategories.find((s) => s.id === line.subCategoryId);

  return (
    <Paper
      withBorder
      shadow="md"
      p="sm"
      // Above the page, wherever it is scrolled to; under the dialogs.
      style={{ position: "fixed", right: 16, bottom: 16, zIndex: 150, maxWidth: 420 }}
    >
      <Stack gap={6}>
        <Text size="sm">
          {t("statements.review.suggestRule", { text, subCategory: sub ? nameOf(sub.names) : "" })}
        </Text>
        {others > 0 && (
          <Text size="xs" c="dimmed">
            {t("statements.review.suggestOthers", { count: others })}
          </Text>
        )}
        <Group gap="xs" justify="flex-end">
          <Button variant="default" size="compact-sm" onClick={onDismiss}>
            {t("statements.review.suggestNo")}
          </Button>
          <Button size="compact-sm" onClick={() => onAccept(line)}>
            {t("statements.review.createRule")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
