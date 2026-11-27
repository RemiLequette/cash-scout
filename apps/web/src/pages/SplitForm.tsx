import {
  budgetMonth,
  entryDateSchema,
  money,
  parseAmount,
  rateSchema,
  shiftToKeep,
  splitInputSchema,
  splitRemainder,
  toDecimalString,
  type SplitInput,
} from "@cash-scout/domain";
import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  Radio,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  decimalInput,
  formatMonthName,
  today,
  useJournalChange,
  useSplit,
  type Split,
} from "../journal";
import { useNameOf, useSubCategoryOptions, type Reference } from "../reference";
import type { Draft } from "./Journal";

interface PartDraft {
  /** Set for a part, or an entry being split, already in the journal. */
  id?: string;
  subCategoryId: string | null;
  description: string;
  /** Not used by the remainder, whose amount follows. */
  amount: string;
}

/** What the form edits: an existing split (id) or a new one. */
export interface SplitDraft {
  id?: string;
  version?: number;
  date: string;
  accountId: string | null;
  exchangeRate: string;
  /** The bank amount, signed. */
  total: string;
  reconciled: boolean;
  /** The budget month a shifted split is meant to count in, "2026-11". */
  keptMonth: string | null;
  parts: PartDraft[];
  /** The index of the part that takes the rest. */
  remainder: number;
}

const newPart = (): PartDraft => ({ subCategoryId: null, description: "", amount: "" });

const emptyDraft = (): SplitDraft => ({
  date: today(),
  accountId: null,
  exchangeRate: "",
  total: "",
  // Usually a movement the bank already shows.
  reconciled: true,
  keptMonth: null,
  parts: [newPart(), newPart()],
  remainder: 1,
});

/** Splitting an entry: it becomes the remainder, so its bank amount does not change. */
export function splitFromEntry(entry: Draft): SplitDraft {
  return {
    date: entry.date,
    accountId: entry.accountId,
    exchangeRate: entry.exchangeRate,
    total: entry.amount,
    reconciled: entry.reconciled,
    keptMonth: entry.keptMonth,
    parts: [
      newPart(),
      {
        id: entry.id,
        subCategoryId: entry.subCategoryId,
        description: entry.description,
        amount: "",
      },
    ],
    remainder: 1,
  };
}

function draftOf(split: Split): SplitDraft {
  const first = split.parts[0]!;
  const total = split.parts.reduce(
    (sum, part) => sum + parseAmount(part.amount, part.currency).minor,
    0n,
  );
  return {
    id: split.id,
    version: split.version,
    date: first.date,
    accountId: first.accountId,
    exchangeRate: first.exchangeRate === "1" ? "" : first.exchangeRate,
    total: toDecimalString(money(total, first.currency)),
    reconciled: first.reconciled,
    keptMonth: first.monthShifted ? budgetMonth(first.date, true) : null,
    parts: split.parts.map((part) => ({
      id: part.id,
      subCategoryId: part.subCategoryId,
      description: part.description,
      amount: part.amount,
    })),
    remainder: Math.max(
      0,
      split.parts.findIndex((part) => part.splitRemainder),
    ),
  };
}

/** The remainder's amount, or undefined while an amount cannot be read. */
function remainderOf(draft: SplitDraft, currency: string): string | undefined {
  try {
    const read = (text: string) => parseAmount(decimalInput(text), currency);
    const others = draft.parts.filter((_, i) => i !== draft.remainder);
    return toDecimalString(
      splitRemainder(
        read(draft.total),
        others.map((part) => read(part.amount)),
      ),
    );
  } catch {
    return undefined;
  }
}

/** The request body, or undefined while the API would refuse it. */
function bodyOf(draft: SplitDraft, currency: string, bookCurrency: string) {
  const rest = remainderOf(draft, currency);
  const needsRate = currency !== bookCurrency;
  const exchangeRate = decimalInput(draft.exchangeRate);
  if (rest === undefined || (needsRate && !rateSchema.safeParse(exchangeRate).success)) {
    return undefined;
  }
  const candidate: SplitInput = {
    date: draft.date,
    accountId: draft.accountId ?? "",
    ...(needsRate && { exchangeRate }),
    reconciled: draft.reconciled,
    monthShifted: draft.keptMonth !== null && shiftToKeep(draft.date, draft.keptMonth),
    parts: draft.parts.map((part, i) => ({
      id: part.id,
      subCategoryId: part.subCategoryId ?? "",
      description: part.description,
      amount: i === draft.remainder ? rest : decimalInput(part.amount),
      remainder: i === draft.remainder,
    })),
  };
  // A saved split left with its remainder alone becomes an ordinary entry.
  const checked =
    draft.id && candidate.parts.length === 1
      ? { ...candidate, parts: [...candidate.parts, { ...candidate.parts[0]!, remainder: false }] }
      : candidate;
  return splitInputSchema.safeParse(checked).success ? candidate : undefined;
}

function Fields({
  bookId,
  bookCurrency,
  reference,
  initial,
  onClose,
  onDuplicate,
}: {
  bookId: string;
  bookCurrency: string;
  reference: Reference;
  initial: SplitDraft;
  onClose: () => void;
  onDuplicate: (draft: SplitDraft) => void;
}) {
  const { t, i18n } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const change = useJournalChange(bookId);
  const [draft, setDraft] = useState(initial);
  const [shown, setShown] = useState(false);
  const set = (patch: Partial<SplitDraft>) => setDraft((old) => ({ ...old, ...patch }));
  const patchPart = (index: number, patch: Partial<PartDraft>) =>
    set({ parts: draft.parts.map((p, i) => (i === index ? { ...p, ...patch } : p)) });

  const account = reference.accounts.find((a) => a.id === draft.accountId);
  const currency = account?.currency ?? bookCurrency;
  const accountOptions = reference.accounts
    .filter((a) => !a.archived || a.id === initial.accountId)
    // An entry of the journal keeps its currency.
    .filter(
      (a) =>
        !initial.parts.some((p) => p.id) ||
        a.currency === reference.accounts.find((x) => x.id === initial.accountId)?.currency,
    )
    .map((a) => ({ value: a.id, label: `${nameOf(a.names)} (${a.currency})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  // Transfers are left out of the totals: a split counts in them.
  const transferNatures = new Set(reference.natures.filter((n) => n.transfer).map((n) => n.id));
  const options = useSubCategoryOptions(
    reference,
    initial.id ? (initial.parts[initial.remainder]?.subCategoryId ?? undefined) : undefined,
    reference.categories.filter((c) => !transferNatures.has(c.natureId)).map((c) => c.id),
  );

  const rest = remainderOf(draft, currency);
  const body = bodyOf(draft, currency, bookCurrency);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!body) {
      setShown(true);
      return;
    }
    change.mutate(
      draft.id
        ? { action: "updateSplit", id: draft.id, body: { ...body, version: draft.version } }
        : { action: "createSplit", body },
      { onSuccess: onClose },
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        {change.error && (
          <Alert color="red">{t("common.error", { message: change.error.message })}</Alert>
        )}
        <Group grow align="flex-start">
          <TextInput
            type="date"
            label={t("journal.date")}
            required
            value={draft.date}
            onChange={(e) => set({ date: e.currentTarget.value })}
          />
          <Select
            label={t("journal.account")}
            required
            searchable
            data={accountOptions}
            value={draft.accountId}
            onChange={(value) => set({ accountId: value })}
          />
          <TextInput
            label={`${t("split.bankAmount")} (${currency})`}
            required
            inputMode="decimal"
            value={draft.total}
            onChange={(e) => set({ total: e.currentTarget.value })}
            data-autofocus
          />
        </Group>
        {entryDateSchema.safeParse(draft.date).success && (
          <Checkbox
            label={t("journal.countIn", {
              month: formatMonthName(budgetMonth(draft.date, true), i18n.language),
            })}
            checked={draft.keptMonth !== null && shiftToKeep(draft.date, draft.keptMonth)}
            onChange={(e) =>
              set({ keptMonth: e.currentTarget.checked ? budgetMonth(draft.date, true) : null })
            }
          />
        )}
        {currency !== bookCurrency && (
          <TextInput
            label={t("journal.exchangeRate")}
            required
            inputMode="decimal"
            value={draft.exchangeRate}
            onChange={(e) => set({ exchangeRate: e.currentTarget.value })}
          />
        )}
        <Table verticalSpacing={4} horizontalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("journal.subCategory")}</Table.Th>
              <Table.Th>{t("journal.description")}</Table.Th>
              <Table.Th w={120} ta="right">
                {t("journal.amount")}
              </Table.Th>
              <Table.Th w={60}>{t("split.remainder")}</Table.Th>
              <Table.Th w={34} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {draft.parts.map((part, index) => {
              const isRest = index === draft.remainder;
              return (
                <Table.Tr key={part.id ?? index}>
                  <Table.Td>
                    <Select
                      aria-label={t("journal.subCategory")}
                      searchable
                      data={options}
                      value={part.subCategoryId}
                      onChange={(value) => patchPart(index, { subCategoryId: value })}
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput
                      aria-label={t("journal.description")}
                      maxLength={500}
                      value={part.description}
                      onChange={(e) => patchPart(index, { description: e.currentTarget.value })}
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput
                      aria-label={t("journal.amount")}
                      inputMode="decimal"
                      disabled={isRest}
                      styles={{ input: { textAlign: "right" } }}
                      value={isRest ? (rest ?? "") : part.amount}
                      onChange={(e) => patchPart(index, { amount: e.currentTarget.value })}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Radio
                      aria-label={t("split.remainder")}
                      checked={isRest}
                      onChange={() =>
                        set({
                          remainder: index,
                          // The former remainder keeps the amount it had.
                          parts: draft.parts.map((p, i) =>
                            i === draft.remainder ? { ...p, amount: rest ?? p.amount } : p,
                          ),
                        })
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={t("split.removePart")}
                      title={t("split.removePart")}
                      disabled={isRest || (!draft.id && draft.parts.length <= 2)}
                      onClick={() =>
                        set({
                          parts: draft.parts.filter((_, i) => i !== index),
                          remainder: draft.remainder - (index < draft.remainder ? 1 : 0),
                        })
                      }
                    >
                      ×
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        <Button
          variant="subtle"
          size="compact-sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() => set({ parts: [...draft.parts, newPart()] })}
        >
          {t("split.addPart")}
        </Button>
        <Switch
          label={t("journal.reconciled")}
          checked={draft.reconciled}
          onChange={(e) => set({ reconciled: e.currentTarget.checked })}
        />
        {shown && !body && (
          <Text size="sm" c="red">
            {t("split.invalid")}
          </Text>
        )}
        <Group justify="space-between">
          <Group gap="xs">
            {initial.id && (
              <>
                <Button
                  variant="subtle"
                  onClick={() =>
                    onDuplicate({
                      ...initial,
                      id: undefined,
                      version: undefined,
                      date: today(),
                      reconciled: false,
                      keptMonth: null,
                      parts: initial.parts.map((p, i) => ({
                        ...p,
                        id: undefined,
                        amount: i === initial.remainder ? "" : p.amount,
                      })),
                    })
                  }
                >
                  {t("journal.duplicate")}
                </Button>
                <Button
                  variant="subtle"
                  color="red"
                  loading={change.isPending && change.variables?.action === "deleteSplit"}
                  onClick={() =>
                    window.confirm(t("split.deleteConfirm")) &&
                    change.mutate(
                      { action: "deleteSplit", id: initial.id! },
                      { onSuccess: onClose },
                    )
                  }
                >
                  {t("common.delete")}
                </Button>
              </>
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
 * Creates a split, or edits an existing one by its id (loaded here): all of its
 * journal entries change together.
 */
export function SplitForm({
  bookId,
  bookCurrency,
  reference,
  splitId,
  from,
  onClose,
  onDuplicate,
}: {
  bookId: string;
  bookCurrency: string;
  reference: Reference;
  splitId?: string;
  /** What a new one starts from: an entry being split, or a duplicate. */
  from?: SplitDraft;
  onClose: () => void;
  onDuplicate: (draft: SplitDraft) => void;
}) {
  const { t } = useTranslation();
  const loaded = useSplit(bookId, splitId);
  if (splitId !== undefined) {
    if (loaded.error) {
      return <Alert color="red">{t("common.error", { message: loaded.error.message })}</Alert>;
    }
    if (!loaded.data) return <Loader size="sm" />;
  }
  return (
    <Fields
      bookId={bookId}
      bookCurrency={bookCurrency}
      reference={reference}
      initial={loaded.data ? draftOf(loaded.data) : (from ?? emptyDraft())}
      onClose={onClose}
      onDuplicate={onDuplicate}
    />
  );
}
