import {
  addDays,
  parseAmount,
  rateSchema,
  transferInputSchema,
  type TransferInput,
} from "@cash-scout/domain";
import { Alert, Button, Group, Loader, Select, Stack, Text, TextInput } from "@mantine/core";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  decimalInput,
  formatDate,
  today,
  useJournalChange,
  useTransfer,
  useTransferDefaults,
  type Transfer,
} from "../journal";
import { useNameOf, type Reference } from "../reference";

/** What the form edits: an existing transfer (id) or a new one. */
export interface TransferDraft {
  id?: string;
  /** Revision of the transfer as read, sent back with the change. */
  version?: number;
  date: string;
  delayDays: string;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  subCategoryId: string | null;
  description: string;
  amount: string;
  destinationAmount: string;
  sourceRate: string;
  destinationRate: string;
}

const emptyDraft = (): TransferDraft => ({
  date: today(),
  delayDays: "0",
  sourceAccountId: null,
  destinationAccountId: null,
  subCategoryId: null,
  description: "",
  amount: "",
  destinationAmount: "",
  sourceRate: "",
  destinationRate: "",
});

const unsigned = (amount: string) => amount.replace(/^[-+]/, "");
const rateText = (rate: string) => (rate === "1" ? "" : rate);

function draftOf(transfer: Transfer): TransferDraft {
  return {
    id: transfer.id,
    version: transfer.version,
    date: transfer.source.date,
    delayDays: String(transfer.delayDays),
    sourceAccountId: transfer.source.accountId,
    destinationAccountId: transfer.destination.accountId,
    subCategoryId: transfer.source.subCategoryId,
    description: transfer.source.description,
    amount: unsigned(transfer.source.amount),
    destinationAmount: unsigned(transfer.destination.amount),
    sourceRate: rateText(transfer.source.exchangeRate),
    destinationRate: rateText(transfer.destination.exchangeRate),
  };
}

type Field =
  | "date"
  | "delayDays"
  | "sourceAccountId"
  | "destinationAccountId"
  | "subCategoryId"
  | "amount"
  | "destinationAmount"
  | "sourceRate"
  | "destinationRate";

/**
 * The accounts' currencies, for what the form asks: a destination amount when
 * they differ, and a rate for each account not in the book currency.
 */
export function needs(
  reference: Reference,
  draft: TransferDraft,
  bookCurrency: string,
): {
  sourceCurrency?: string;
  destinationCurrency?: string;
  amountInTwo: boolean;
  sourceRate: boolean;
  destinationRate: boolean;
} {
  const sourceCurrency = reference.accounts.find((a) => a.id === draft.sourceAccountId)?.currency;
  const destinationCurrency = reference.accounts.find(
    (a) => a.id === draft.destinationAccountId,
  )?.currency;
  return {
    sourceCurrency,
    destinationCurrency,
    amountInTwo:
      sourceCurrency !== undefined &&
      destinationCurrency !== undefined &&
      sourceCurrency !== destinationCurrency,
    sourceRate: sourceCurrency !== undefined && sourceCurrency !== bookCurrency,
    destinationRate: destinationCurrency !== undefined && destinationCurrency !== bookCurrency,
  };
}

/** Checks the draft as the API will, and builds the request body. */
export function validate(
  draft: TransferDraft,
  reference: Reference,
  bookCurrency: string,
): { body?: TransferInput; errors: Partial<Record<Field, true>> } {
  const errors: Partial<Record<Field, true>> = {};
  const wants = needs(reference, draft, bookCurrency);
  const amount = decimalInput(draft.amount);
  const destinationAmount = decimalInput(draft.destinationAmount);
  const candidate = {
    date: draft.date,
    delayDays: draft.delayDays.trim() === "" ? Number.NaN : Number(draft.delayDays),
    sourceAccountId: draft.sourceAccountId ?? "",
    destinationAccountId: draft.destinationAccountId ?? "",
    subCategoryId: draft.subCategoryId ?? "",
    description: draft.description,
    amount,
    ...(wants.amountInTwo && { destinationAmount }),
    ...(wants.sourceRate && { sourceRate: decimalInput(draft.sourceRate) }),
    ...(wants.destinationRate && { destinationRate: decimalInput(draft.destinationRate) }),
  };
  const parsed = transferInputSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors[issue.path[0] as Field] = true;
    }
  }
  // Decimals allowed by the currencies.
  const fits = (value: string, currency: string | undefined) => {
    if (!currency) return true;
    try {
      parseAmount(value, currency);
      return true;
    } catch {
      return false;
    }
  };
  if (!fits(amount, wants.sourceCurrency)) errors.amount = true;
  if (wants.amountInTwo && !fits(destinationAmount, wants.destinationCurrency)) {
    errors.destinationAmount = true;
  }
  if (wants.sourceRate && !rateSchema.safeParse(candidate.sourceRate).success) {
    errors.sourceRate = true;
  }
  if (wants.destinationRate && !rateSchema.safeParse(candidate.destinationRate).success) {
    errors.destinationRate = true;
  }
  return Object.keys(errors).length === 0
    ? { body: candidate as TransferInput, errors }
    : { errors };
}

function TransferFields({
  bookId,
  bookCurrency,
  reference,
  initial,
  onClose,
}: {
  bookId: string;
  bookCurrency: string;
  reference: Reference;
  initial: TransferDraft;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const change = useJournalChange(bookId);
  const [draft, setDraft] = useState(initial);
  const [shown, setShown] = useState<Partial<Record<Field, true>>>({});
  const set = (patch: Partial<TransferDraft>) => setDraft({ ...draft, ...patch });

  const editing = initial.id !== undefined;
  const wants = needs(reference, draft, bookCurrency);
  const { body, errors } = validate(draft, reference, bookCurrency);
  const error = (field: Field) => (shown[field] ? t(`transfer.invalid.${field}`) : undefined);

  // An account the transfer already uses stays offered once archived; when editing,
  // a side only moves to an account in the same currency.
  const accountOptions = (current: string | null, other: string | null) => {
    const currency = reference.accounts.find((a) => a.id === current)?.currency;
    return reference.accounts
      .filter((a) => a.kind === "bank" && a.id !== other)
      .filter((a) => !a.archived || a.id === current)
      .filter((a) => !editing || a.currency === currency)
      .map((a) => ({ value: a.id, label: `${nameOf(a.names)} (${a.currency})` }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };
  const transferNatures = new Set(reference.natures.filter((n) => n.transfer).map((n) => n.id));
  const transferCategories = reference.categories.filter((c) => transferNatures.has(c.natureId));
  const subCategoryOptions = transferCategories
    .map((category) => ({
      group: `${category.code} ${nameOf(category.names)}`,
      items: reference.subCategories
        .filter(
          (s) => s.categoryId === category.id && (!s.archived || s.id === initial.subCategoryId),
        )
        .map((s) => ({ value: s.id, label: nameOf(s.names) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .filter((group) => group.items.length > 0);
  const delay = Number(draft.delayDays);
  const arrival =
    errors.date || errors.delayDays || Number.isNaN(delay)
      ? undefined
      : formatDate(addDays(draft.date, delay), i18n.language);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!body) {
      setShown(errors);
      return;
    }
    change.mutate(
      draft.id
        ? { action: "updateTransfer", id: draft.id, body: { ...body, version: draft.version } }
        : { action: "createTransfer", body },
      { onSuccess: onClose },
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        {change.error && (
          <Alert color="red">{t("common.error", { message: change.error.message })}</Alert>
        )}
        {transferCategories.length === 0 && (
          <Alert color="yellow">{t("transfer.noCategory")}</Alert>
        )}
        <Group grow align="flex-start">
          <Select
            label={t("transfer.source")}
            required
            searchable
            data={accountOptions(draft.sourceAccountId, draft.destinationAccountId)}
            value={draft.sourceAccountId}
            error={error("sourceAccountId")}
            onChange={(value) => set({ sourceAccountId: value })}
          />
          <Select
            label={t("transfer.destination")}
            required
            searchable
            data={accountOptions(draft.destinationAccountId, draft.sourceAccountId)}
            value={draft.destinationAccountId}
            error={error("destinationAccountId")}
            onChange={(value) => set({ destinationAccountId: value })}
          />
        </Group>
        <Group grow align="flex-start">
          <TextInput
            type="date"
            label={t("transfer.date")}
            description={t("transfer.dateHint")}
            required
            value={draft.date}
            error={error("date")}
            onChange={(e) => set({ date: e.currentTarget.value })}
          />
          <TextInput
            type="number"
            min={0}
            max={60}
            label={t("transfer.delay")}
            description={
              arrival ? t("transfer.arrival", { date: arrival }) : t("transfer.delayHint")
            }
            required
            value={draft.delayDays}
            error={error("delayDays")}
            onChange={(e) => set({ delayDays: e.currentTarget.value })}
          />
        </Group>
        <Group grow align="flex-start">
          <TextInput
            label={
              wants.sourceCurrency
                ? `${t("transfer.amount")} (${wants.sourceCurrency})`
                : t("transfer.amount")
            }
            description={t("transfer.amountHint")}
            required
            inputMode="decimal"
            placeholder={t("transfer.amountPlaceholder")}
            value={draft.amount}
            error={error("amount")}
            onChange={(e) => set({ amount: e.currentTarget.value })}
          />
          {wants.amountInTwo && (
            <TextInput
              label={`${t("transfer.destinationAmount")} (${wants.destinationCurrency})`}
              description={t("transfer.destinationAmountHint")}
              required
              inputMode="decimal"
              value={draft.destinationAmount}
              error={error("destinationAmount")}
              onChange={(e) => set({ destinationAmount: e.currentTarget.value })}
            />
          )}
        </Group>
        {(wants.sourceRate || wants.destinationRate) && (
          <Group grow align="flex-start">
            {wants.sourceRate && (
              <TextInput
                label={`${t("journal.exchangeRate")} (${wants.sourceCurrency})`}
                description={t("journal.exchangeRateHint", {
                  from: wants.sourceCurrency,
                  to: bookCurrency,
                })}
                required
                inputMode="decimal"
                value={draft.sourceRate}
                error={error("sourceRate")}
                onChange={(e) => set({ sourceRate: e.currentTarget.value })}
              />
            )}
            {wants.destinationRate && (
              <TextInput
                label={`${t("journal.exchangeRate")} (${wants.destinationCurrency})`}
                description={t("journal.exchangeRateHint", {
                  from: wants.destinationCurrency,
                  to: bookCurrency,
                })}
                required
                inputMode="decimal"
                value={draft.destinationRate}
                error={error("destinationRate")}
                onChange={(e) => set({ destinationRate: e.currentTarget.value })}
              />
            )}
          </Group>
        )}
        <Select
          label={t("journal.subCategory")}
          description={t("transfer.subCategoryHint")}
          required
          searchable
          data={subCategoryOptions}
          value={draft.subCategoryId}
          error={error("subCategoryId")}
          onChange={(value) => set({ subCategoryId: value })}
        />
        <TextInput
          label={t("journal.description")}
          maxLength={500}
          value={draft.description}
          onChange={(e) => set({ description: e.currentTarget.value })}
        />
        <Text size="sm" c="dimmed">
          {t("transfer.reconcileHint")}
        </Text>
        <Group justify="space-between">
          <Group gap="xs">
            {draft.id && (
              <Button
                variant="subtle"
                color="red"
                loading={change.isPending && change.variables?.action === "deleteTransfer"}
                onClick={() =>
                  window.confirm(t("transfer.deleteConfirm")) &&
                  change.mutate({ action: "deleteTransfer", id: draft.id! }, { onSuccess: onClose })
                }
              >
                {t("common.delete")}
              </Button>
            )}
          </Group>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={change.isPending}>
              {draft.id ? t("common.save") : t("common.create")}
            </Button>
          </Group>
        </Group>
      </Stack>
    </form>
  );
}

/**
 * Creates a transfer between two accounts, or edits an existing one by its id
 * (loaded here): both of its journal entries change together.
 */
export function TransferForm({
  bookId,
  bookCurrency,
  reference,
  transferId,
  onClose,
}: {
  bookId: string;
  bookCurrency: string;
  reference: Reference;
  transferId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const loaded = useTransfer(bookId, transferId);
  const defaults = useTransferDefaults(bookId, transferId === undefined);
  if (transferId !== undefined) {
    if (loaded.error) {
      return <Alert color="red">{t("common.error", { message: loaded.error.message })}</Alert>;
    }
    if (!loaded.data) return <Loader size="sm" />;
  } else if (defaults.isPending) {
    return <Loader size="sm" />;
  }
  // A new transfer starts from what the book's transfers use most.
  const initial = loaded.data
    ? draftOf(loaded.data)
    : {
        ...emptyDraft(),
        subCategoryId: defaults.data?.subCategoryId ?? null,
      };
  return (
    <TransferFields
      bookId={bookId}
      bookCurrency={bookCurrency}
      reference={reference}
      initial={initial}
      onClose={onClose}
    />
  );
}
