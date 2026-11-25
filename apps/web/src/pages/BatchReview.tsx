import { formatMoney, parseAmount, type ReviewChanges } from "@cash-scout/domain";
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
import { useReference, useSubCategoryOptions, type Reference } from "../reference";
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
  // Lines with nothing chosen and no proposal yet: the rules may have something for them.
  const open = batch.lines.filter(
    (l) => l.status === "review" && !l.subCategoryId && !l.entry && !l.ruleId,
  ).length;
  const ruleOf = (line: BatchLine) => rules.data?.find((r) => r.id === line.ruleId);
  const [filter, setFilter] = useState<Filter>(() =>
    batch.lines.some((l) => l.status === "review") ? "review" : "all",
  );
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const options = useSubCategoryOptions(reference);

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
    (l) => l.status === "review" && !l.duplicate && l.candidates.length > 0,
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
            <Select
              aria-label={t("statements.review.forSelected")}
              placeholder={t("statements.review.forSelected")}
              searchable
              data={options}
              value={null}
              onChange={(value) => value && saveChosen({ subCategoryId: value })}
              w={280}
            />
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
        <Table.ScrollContainer minWidth={820}>
          <Table highlightOnHover verticalSpacing="xs">
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
                  rule={ruleOf(line)}
                  onCreateRule={() => setRuleFor(line)}
                  selected={selected.has(line.id)}
                  onSelect={(on) => toggle([line.id], on)}
                  onChange={(change) => save([{ id: line.id, ...change }])}
                />
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {pages > 1 && <Pagination total={pages} value={current} onChange={setPage} />}

      <ImportPanel bookId={bookId} batch={batch} saving={review.isPending} />
      {ruleFor && (
        <RuleForm
          bookId={bookId}
          initial={draftOf({
            text: ruleFor.counterparty || ruleFor.label,
            subCategoryId: ruleFor.subCategoryId,
            description: ruleFor.description,
          })}
          sample={{
            accountId: batch.accountId,
            currency: batch.currency,
            lines: batch.lines.filter((l) => l.status === "review"),
          }}
          onClose={() => setRuleFor(null)}
          onSaved={() => apply.mutate()}
        />
      )}
    </Stack>
  );
}

function Line({
  line,
  currency,
  options,
  rule,
  onCreateRule,
  selected,
  onSelect,
  onChange,
}: {
  line: BatchLine;
  currency: string;
  options: ReturnType<typeof useSubCategoryOptions>;
  rule: Rule | undefined;
  onCreateRule: () => void;
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
          options={options}
          rule={rule}
          onCreateRule={onCreateRule}
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
function Decision({
  line,
  options,
  rule,
  onCreateRule,
  onChange,
}: {
  line: BatchLine;
  options: ReturnType<typeof useSubCategoryOptions>;
  rule: Rule | undefined;
  onCreateRule: () => void;
  onChange: (change: Omit<Change, "id">) => void;
}) {
  const { t } = useTranslation();
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
        <Text size="sm">{t("statements.review.willReconcile", named(line.entry))}</Text>
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
        </Button>
      ))}
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
      {rule && (
        <Text size="xs" c="grape">
          {rule.ignore
            ? t("statements.review.ruleIgnores", { name: rule.name })
            : t("statements.review.ruleProposes", { name: rule.name })}
        </Text>
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
