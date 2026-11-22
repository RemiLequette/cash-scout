import {
  entryInputSchema,
  formatMoney,
  parseAmount,
  rateSchema,
  type EntryInput,
} from "@cash-scout/domain";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Group,
  Menu,
  Modal,
  Pagination,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  decimalInput,
  formatDate,
  today,
  useBalances,
  useJournal,
  useJournalChange,
  type Entry,
} from "../journal";
import { currencyOptions } from "../options";
import { useNameOf, useReference, type Reference } from "../reference";

const PAGE_SIZE = 50;

function ErrorAlert({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  return error ? <Alert color="red">{t("common.error", { message: error.message })}</Alert> : null;
}

/** Formats a decimal amount from the API in its currency for the interface language. */
function useMoney() {
  const { i18n } = useTranslation();
  return (amount: string, currency: string) =>
    formatMoney(parseAmount(amount, currency), i18n.language);
}

/** Sub-categories grouped under their category, for a select; archived ones only if kept. */
function useSubCategoryOptions(reference: Reference, keep?: string) {
  const nameOf = useNameOf(reference.defaultLanguage);
  return reference.categories
    .map((category) => ({
      group: `${category.code} ${nameOf(category.names)}`,
      items: reference.subCategories
        .filter((s) => s.categoryId === category.id && (!s.archived || s.id === keep))
        .map((s) => ({ value: s.id, label: nameOf(s.names) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .filter((group) => group.items.length > 0);
}

// ---------------------------------------------------------------------------
// Entry form
// ---------------------------------------------------------------------------

/** What the form edits: an existing entry (id) or a new one, possibly a duplicate. */
interface Draft {
  id?: string;
  date: string;
  accountId: string | null;
  subCategoryId: string | null;
  description: string;
  paymentTypeId: string | null;
  amount: string;
  exchangeRate: string;
  originalAmount: string;
  originalCurrency: string | null;
  reconciled: boolean;
  /** Shown read-only when editing. */
  plannedAmount?: string;
  variance?: string;
  currency?: string;
}

function draftOf(entry: Entry, mode: "edit" | "duplicate"): Draft {
  return {
    id: mode === "edit" ? entry.id : undefined,
    date: mode === "edit" ? entry.date : today(),
    accountId: entry.accountId,
    subCategoryId: entry.subCategoryId,
    description: entry.description,
    paymentTypeId: entry.paymentTypeId,
    amount: entry.amount,
    exchangeRate: entry.exchangeRate === "1" ? "" : entry.exchangeRate,
    originalAmount: entry.originalAmount ?? "",
    originalCurrency: entry.originalCurrency,
    reconciled: mode === "edit" ? entry.reconciled : false,
    ...(mode === "edit" && {
      plannedAmount: entry.plannedAmount,
      variance: entry.variance,
      currency: entry.currency,
    }),
  };
}

const emptyDraft = (): Draft => ({
  date: today(),
  accountId: null,
  subCategoryId: null,
  description: "",
  paymentTypeId: null,
  amount: "",
  exchangeRate: "",
  originalAmount: "",
  originalCurrency: null,
  reconciled: false,
});

type Field =
  | "date"
  | "accountId"
  | "subCategoryId"
  | "amount"
  | "exchangeRate"
  | "originalAmount"
  | "originalCurrency";

/**
 * Checks the draft as the API will, and builds the request body.
 * Returns the fields in error, translated by the caller.
 */
function validate(
  draft: Draft,
  accountCurrency: string | undefined,
  bookCurrency: string,
): { body?: EntryInput; errors: Partial<Record<Field, true>> } {
  const errors: Partial<Record<Field, true>> = {};
  const needsRate = accountCurrency !== undefined && accountCurrency !== bookCurrency;
  const amount = decimalInput(draft.amount);
  const exchangeRate = decimalInput(draft.exchangeRate);
  const originalAmount = decimalInput(draft.originalAmount);
  const candidate = {
    date: draft.date,
    accountId: draft.accountId ?? "",
    subCategoryId: draft.subCategoryId ?? "",
    description: draft.description,
    paymentTypeId: draft.paymentTypeId,
    amount,
    ...(needsRate && { exchangeRate }),
    originalAmount: originalAmount || null,
    originalCurrency: originalAmount ? draft.originalCurrency : null,
    reconciled: draft.reconciled,
  };
  const parsed = entryInputSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors[issue.path[0] as Field] = true;
    }
  }
  // Decimals allowed by the currencies.
  const fits = (value: string, currency: string | null | undefined) => {
    if (!currency) return true;
    try {
      parseAmount(value, currency);
      return true;
    } catch {
      return false;
    }
  };
  if (!fits(amount, accountCurrency)) errors.amount = true;
  if (originalAmount && !fits(originalAmount, draft.originalCurrency)) errors.originalAmount = true;
  if (needsRate && !rateSchema.safeParse(exchangeRate).success) errors.exchangeRate = true;
  return Object.keys(errors).length === 0 ? { body: candidate as EntryInput, errors } : { errors };
}

function EntryForm({
  bookId,
  bookCurrency,
  reference,
  initial,
  onClose,
}: {
  bookId: string;
  bookCurrency: string;
  reference: Reference;
  initial: Draft;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const formatAmount = useMoney();
  const change = useJournalChange(bookId);
  const [draft, setDraft] = useState(initial);
  const [shown, setShown] = useState<Partial<Record<Field, true>>>({});
  const [showOriginal, setShowOriginal] = useState(initial.originalAmount !== "");
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  // Archived items are offered only when the entry already uses them.
  const accountOptions = reference.accounts
    .filter((a) => !a.archived || a.id === initial.accountId)
    // When editing, the account can only change to one in the same currency.
    .filter((a) => !initial.id || a.currency === initial.currency)
    .map((a) => ({ value: a.id, label: `${nameOf(a.names)} (${a.currency})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const subCategoryOptions = useSubCategoryOptions(
    reference,
    initial.id ? (initial.subCategoryId ?? undefined) : undefined,
  );
  const paymentTypeOptions = reference.paymentTypes
    .filter((p) => !p.archived || p.id === initial.paymentTypeId)
    .map((p) => ({ value: p.id, label: nameOf(p.names) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const account = reference.accounts.find((a) => a.id === draft.accountId);
  const needsRate = account !== undefined && account.currency !== bookCurrency;
  const { body, errors } = validate(draft, account?.currency, bookCurrency);
  const error = (field: Field) => (shown[field] ? t(`journal.invalid.${field}`) : undefined);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!body) {
      setShown(errors);
      return;
    }
    if (draft.id) {
      // The planned amount is fixed: the API ignores it, so it is not sent.
      change.mutate({ action: "update", id: draft.id, body }, { onSuccess: onClose });
    } else {
      change.mutate({ action: "create", body }, { onSuccess: onClose });
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <ErrorAlert error={change.error} />
        <Group grow align="flex-start">
          <TextInput
            type="date"
            label={t("journal.date")}
            required
            value={draft.date}
            error={error("date")}
            onChange={(e) => set({ date: e.currentTarget.value })}
          />
          <Select
            label={t("journal.account")}
            required
            searchable
            data={accountOptions}
            value={draft.accountId}
            error={error("accountId")}
            onChange={(value) => set({ accountId: value })}
          />
        </Group>
        <Select
          label={t("journal.subCategory")}
          description={t("journal.subCategoryHint")}
          required
          searchable
          data={subCategoryOptions}
          value={draft.subCategoryId}
          error={error("subCategoryId")}
          onChange={(value) => set({ subCategoryId: value })}
          data-autofocus
        />
        <TextInput
          label={t("journal.description")}
          maxLength={500}
          value={draft.description}
          onChange={(e) => set({ description: e.currentTarget.value })}
        />
        <Group grow align="flex-start">
          <TextInput
            label={account ? `${t("journal.amount")} (${account.currency})` : t("journal.amount")}
            description={t("journal.amountHint")}
            required
            inputMode="decimal"
            placeholder={t("journal.amountPlaceholder")}
            value={draft.amount}
            error={error("amount")}
            onChange={(e) => set({ amount: e.currentTarget.value })}
          />
          <Select
            label={t("journal.paymentType")}
            clearable
            data={paymentTypeOptions}
            value={draft.paymentTypeId}
            onChange={(value) => set({ paymentTypeId: value })}
          />
        </Group>
        {needsRate && (
          <TextInput
            label={t("journal.exchangeRate")}
            description={t("journal.exchangeRateHint", {
              from: account.currency,
              to: bookCurrency,
            })}
            required
            inputMode="decimal"
            value={draft.exchangeRate}
            error={error("exchangeRate")}
            onChange={(e) => set({ exchangeRate: e.currentTarget.value })}
          />
        )}
        {draft.id && draft.plannedAmount && draft.currency && (
          <Text size="sm" c="dimmed">
            {t("journal.plannedAndVariance", {
              planned: formatAmount(draft.plannedAmount, draft.currency),
              variance: formatAmount(draft.variance ?? "0", draft.currency),
            })}
          </Text>
        )}
        <Button
          variant="subtle"
          size="compact-sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() => setShowOriginal(!showOriginal)}
        >
          {t("journal.originalToggle")}
        </Button>
        <Collapse expanded={showOriginal}>
          <Group grow align="flex-start">
            <TextInput
              label={t("journal.originalAmount")}
              description={t("journal.originalHint")}
              inputMode="decimal"
              value={draft.originalAmount}
              error={error("originalAmount")}
              onChange={(e) => set({ originalAmount: e.currentTarget.value })}
            />
            <Select
              label={t("journal.originalCurrency")}
              searchable
              clearable
              data={currencyOptions(i18n.language)}
              value={draft.originalCurrency}
              error={error("originalCurrency")}
              onChange={(value) => set({ originalCurrency: value })}
            />
          </Group>
        </Collapse>
        <Switch
          label={t("journal.reconciled")}
          description={t("journal.reconciledHint")}
          checked={draft.reconciled}
          onChange={(e) => set({ reconciled: e.currentTarget.checked })}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={change.isPending}>
            {draft.id ? t("common.save") : t("common.create")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

function Balances({ bookId, reference }: { bookId: string; reference: Reference }) {
  const { t } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const formatAmount = useMoney();
  const balances = useBalances(bookId);
  const rows = (balances.data ?? [])
    .map((balance) => ({
      ...balance,
      account: reference.accounts.find((a) => a.id === balance.accountId),
    }))
    // Archived accounts only while they still hold money.
    .filter(
      (b) =>
        b.account && (!b.account.archived || Number(b.total) !== 0 || Number(b.reconciled) !== 0),
    )
    .sort((a, b) => nameOf(a.account!.names).localeCompare(nameOf(b.account!.names)));
  if (rows.length === 0) return null;
  return (
    <Paper withBorder p="sm">
      <Title order={5} mb="xs">
        {t("journal.balances")}
      </Title>
      <ErrorAlert error={balances.error} />
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("journal.account")}</Table.Th>
            <Table.Th ta="right">{t("journal.balanceReconciled")}</Table.Th>
            <Table.Th ta="right">{t("journal.balanceTotal")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={row.accountId}>
              <Table.Td>
                {nameOf(row.account!.names)}
                {row.account!.kind === "virtual" && (
                  <Badge ml="xs" size="xs" variant="outline">
                    {t("accountKinds.virtual")}
                  </Badge>
                )}
              </Table.Td>
              <Table.Td ta="right">{formatAmount(row.reconciled, row.currency)}</Table.Td>
              <Table.Td ta="right">{formatAmount(row.total, row.currency)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Journal({
  bookId,
  bookCurrency,
  canEdit,
}: {
  bookId: string;
  bookCurrency: string;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation();
  const reference = useReference(bookId);
  const formatAmount = useMoney();
  const nameOf = useNameOf(reference.data?.defaultLanguage);
  const change = useJournalChange(bookId);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | "true" | "false">("all");
  const [search, setSearch] = useState("");
  const [q] = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  const [kind, filterId] = categoryFilter?.split(":") ?? [];
  const list = useJournal(bookId, {
    from: from || undefined,
    to: to || undefined,
    accountId: accountId ?? undefined,
    categoryId: kind === "c" ? filterId : undefined,
    subCategoryId: kind === "s" ? filterId : undefined,
    reconciled: status === "all" ? undefined : status,
    q: q || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  /** Any filter change goes back to the first page and clears the selection. */
  const filtered =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
      setSelected([]);
    };

  if (reference.error) return <ErrorAlert error={reference.error} />;
  if (!reference.data) return null;
  const ref = reference.data;

  const accountName = (id: string) => {
    const account = ref.accounts.find((a) => a.id === id);
    return account ? nameOf(account.names) : "";
  };
  const subCategoryLabel = (id: string) => {
    const sub = ref.subCategories.find((s) => s.id === id);
    const category = ref.categories.find((c) => c.id === sub?.categoryId);
    return { sub: sub ? nameOf(sub.names) : "", category };
  };
  const paymentTypeName = (id: string | null) => {
    const item = ref.paymentTypes.find((p) => p.id === id);
    return item ? nameOf(item.names) : "";
  };

  const categoryFilterOptions = ref.categories.map((category) => ({
    group: `${category.code} ${nameOf(category.names)}`,
    items: [
      { value: `c:${category.id}`, label: `${t("journal.allOf")} ${nameOf(category.names)}` },
      ...ref.subCategories
        .filter((s) => s.categoryId === category.id)
        .map((s) => ({ value: `s:${s.id}`, label: nameOf(s.names) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ],
  }));
  const accountFilterOptions = ref.accounts
    .map((a) => ({ value: a.id, label: nameOf(a.names) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const entries = list.data?.entries ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allSelected = entries.length > 0 && entries.every((e) => selected.includes(e.id));
  const canAdd =
    ref.accounts.some((a) => !a.archived) && ref.subCategories.some((s) => !s.archived);

  const reconcile = (ids: string[], reconciled: boolean) =>
    change.mutate({ action: "reconcile", ids, reconciled }, { onSuccess: () => setSelected([]) });

  return (
    <Stack>
      <Balances bookId={bookId} reference={ref} />

      <Group justify="space-between" align="flex-end">
        <Group align="flex-end" gap="xs">
          <TextInput
            type="date"
            label={t("journal.from")}
            value={from}
            onChange={(e) => filtered(setFrom)(e.currentTarget.value)}
          />
          <TextInput
            type="date"
            label={t("journal.to")}
            value={to}
            onChange={(e) => filtered(setTo)(e.currentTarget.value)}
          />
          <Select
            label={t("journal.account")}
            placeholder={t("journal.allAccounts")}
            clearable
            data={accountFilterOptions}
            value={accountId}
            onChange={filtered(setAccountId)}
          />
          <Select
            label={t("journal.category")}
            placeholder={t("journal.allCategories")}
            clearable
            searchable
            data={categoryFilterOptions}
            value={categoryFilter}
            onChange={filtered(setCategoryFilter)}
          />
          <TextInput
            label={t("journal.search")}
            value={search}
            onChange={(e) => filtered(setSearch)(e.currentTarget.value)}
          />
          <SegmentedControl
            data={[
              { value: "all", label: t("journal.all") },
              { value: "true", label: t("journal.reconciledShort") },
              { value: "false", label: t("journal.forecasts") },
            ]}
            value={status}
            onChange={(value) => filtered(setStatus)(value as typeof status)}
          />
        </Group>
        {canEdit && (
          <Button disabled={!canAdd} onClick={() => setDraft(emptyDraft())}>
            {t("journal.newEntry")}
          </Button>
        )}
      </Group>
      {canEdit && !canAdd && <Text c="dimmed">{t("journal.needsReference")}</Text>}

      <ErrorAlert error={list.error ?? change.error} />

      {canEdit && selected.length > 0 && (
        <Group>
          <Text size="sm">{t("journal.selected", { count: selected.length })}</Text>
          <Button size="xs" variant="light" onClick={() => reconcile(selected, true)}>
            {t("journal.markReconciled")}
          </Button>
          <Button size="xs" variant="default" onClick={() => reconcile(selected, false)}>
            {t("journal.markForecast")}
          </Button>
        </Group>
      )}

      {list.data && entries.length === 0 && <Text c="dimmed">{t("journal.empty")}</Text>}
      {entries.length > 0 && (
        <Table.ScrollContainer minWidth={760}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                {canEdit && (
                  <Table.Th w={36}>
                    <Checkbox
                      aria-label={t("journal.selectAll")}
                      checked={allSelected}
                      indeterminate={selected.length > 0 && !allSelected}
                      onChange={() => setSelected(allSelected ? [] : entries.map((e) => e.id))}
                    />
                  </Table.Th>
                )}
                <Table.Th>{t("journal.date")}</Table.Th>
                <Table.Th>{t("journal.description")}</Table.Th>
                <Table.Th>{t("journal.subCategory")}</Table.Th>
                <Table.Th>{t("journal.account")}</Table.Th>
                <Table.Th>{t("journal.paymentType")}</Table.Th>
                <Table.Th ta="right">{t("journal.amount")}</Table.Th>
                <Table.Th ta="center">{t("journal.reconciled")}</Table.Th>
                {canEdit && <Table.Th w={40} />}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((entry) => {
                const { sub, category } = subCategoryLabel(entry.subCategoryId);
                const otherCurrency = entry.currency !== bookCurrency;
                return (
                  <Table.Tr key={entry.id} c={entry.reconciled ? undefined : "dimmed"}>
                    {canEdit && (
                      <Table.Td>
                        <Checkbox
                          aria-label={t("journal.select")}
                          checked={selected.includes(entry.id)}
                          onChange={(e) =>
                            setSelected(
                              e.currentTarget.checked
                                ? [...selected, entry.id]
                                : selected.filter((id) => id !== entry.id),
                            )
                          }
                        />
                      </Table.Td>
                    )}
                    <Table.Td style={{ whiteSpace: "nowrap" }}>
                      {formatDate(entry.date, i18n.language)}
                    </Table.Td>
                    <Table.Td>{entry.description}</Table.Td>
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        {category && (
                          <Badge size="xs" variant="light">
                            {category.code}
                          </Badge>
                        )}
                        <Text size="sm" span>
                          {sub}
                        </Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>{accountName(entry.accountId)}</Table.Td>
                    <Table.Td>{paymentTypeName(entry.paymentTypeId)}</Table.Td>
                    <Table.Td ta="right" style={{ whiteSpace: "nowrap" }}>
                      <Text size="sm" fw={500} span>
                        {formatAmount(entry.amount, entry.currency)}
                      </Text>
                      {otherCurrency && (
                        <Text size="xs" c="dimmed">
                          {formatAmount(entry.bookAmount, bookCurrency)}
                        </Text>
                      )}
                      {Number(entry.variance) !== 0 && (
                        <Text size="xs" c="dimmed">
                          {t("journal.plannedShort", {
                            planned: formatAmount(entry.plannedAmount, entry.currency),
                          })}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td ta="center">
                      <Checkbox
                        aria-label={t("journal.reconciled")}
                        style={{ display: "inline-block" }}
                        disabled={!canEdit}
                        checked={entry.reconciled}
                        onChange={(e) => reconcile([entry.id], e.currentTarget.checked)}
                      />
                    </Table.Td>
                    {canEdit && (
                      <Table.Td>
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" aria-label={t("reference.actions")}>
                              ⋯
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item onClick={() => setDraft(draftOf(entry, "edit"))}>
                              {t("reference.edit")}
                            </Menu.Item>
                            <Menu.Item onClick={() => setDraft(draftOf(entry, "duplicate"))}>
                              {t("journal.duplicate")}
                            </Menu.Item>
                            <Menu.Item
                              color="red"
                              onClick={() =>
                                window.confirm(t("journal.deleteConfirm")) &&
                                change.mutate({ action: "delete", id: entry.id })
                              }
                            >
                              {t("common.delete")}
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Table.Td>
                    )}
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {total > 0 && (
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {t("journal.count", { count: total })}
          </Text>
          {pages > 1 && <Pagination total={pages} value={page} onChange={setPage} />}
        </Group>
      )}

      <Modal
        size="lg"
        opened={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t("journal.editEntry") : t("journal.newEntry")}
      >
        {draft && (
          <EntryForm
            bookId={bookId}
            bookCurrency={bookCurrency}
            reference={ref}
            initial={draft}
            onClose={() => setDraft(null)}
          />
        )}
      </Modal>
    </Stack>
  );
}
