import { compensationInputSchema, parseAmount, type CompensationInput } from "@cash-scout/domain";
import { Alert, Button, Group, Loader, Select, Stack, TextInput } from "@mantine/core";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  decimalInput,
  today,
  useCompensation,
  useJournalChange,
  type Compensation,
} from "../journal";
import { useSubCategoryOptions, type Reference } from "../reference";

/** What the form edits: an existing compensation (id) or a new one, possibly a duplicate. */
export interface CompensationDraft {
  id?: string;
  /** Revision of the compensation as read, sent back with the change. */
  version?: number;
  date: string;
  description: string;
  plusSubCategoryId: string | null;
  minusSubCategoryId: string | null;
  amount: string;
}

const emptyDraft = (): CompensationDraft => ({
  date: today(),
  description: "",
  plusSubCategoryId: null,
  minusSubCategoryId: null,
  amount: "",
});

const draftOf = (compensation: Compensation): CompensationDraft => ({
  id: compensation.id,
  version: compensation.version,
  date: compensation.plus.date,
  description: compensation.plus.description,
  plusSubCategoryId: compensation.plus.subCategoryId,
  minusSubCategoryId: compensation.minus.subCategoryId,
  amount: compensation.plus.amount,
});

type Field = "date" | "plusSubCategoryId" | "minusSubCategoryId" | "amount";

/** Checks the draft as the API will, and builds the request body. */
function validate(
  draft: CompensationDraft,
  bookCurrency: string,
): { body?: CompensationInput; errors: Partial<Record<Field, true>> } {
  const errors: Partial<Record<Field, true>> = {};
  const candidate = {
    date: draft.date,
    description: draft.description,
    plusSubCategoryId: draft.plusSubCategoryId ?? "",
    minusSubCategoryId: draft.minusSubCategoryId ?? "",
    amount: decimalInput(draft.amount),
  };
  const parsed = compensationInputSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors[issue.path[0] as Field] = true;
    }
  }
  // Decimals allowed by the currency.
  try {
    parseAmount(candidate.amount, bookCurrency);
  } catch {
    errors.amount = true;
  }
  return Object.keys(errors).length === 0 ? { body: candidate, errors } : { errors };
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
  initial: CompensationDraft;
  onClose: () => void;
  onDuplicate: (draft: CompensationDraft) => void;
}) {
  const { t } = useTranslation();
  const change = useJournalChange(bookId);
  const [draft, setDraft] = useState(initial);
  const [shown, setShown] = useState<Partial<Record<Field, true>>>({});
  const set = (patch: Partial<CompensationDraft>) => setDraft({ ...draft, ...patch });
  const { body, errors } = validate(draft, bookCurrency);
  const error = (field: Field) => (shown[field] ? t(`compensation.invalid.${field}`) : undefined);

  // Transfers are left out of the totals: a compensation counts in them.
  const transferNatures = new Set(reference.natures.filter((n) => n.transfer).map((n) => n.id));
  const counted = reference.categories
    .filter((c) => !transferNatures.has(c.natureId))
    .map((c) => c.id);
  // Archived sub-categories are offered only when the compensation already uses them.
  const plusOptions = useSubCategoryOptions(
    reference,
    initial.id ? (initial.plusSubCategoryId ?? undefined) : undefined,
    counted,
  );
  const minusOptions = useSubCategoryOptions(
    reference,
    initial.id ? (initial.minusSubCategoryId ?? undefined) : undefined,
    counted,
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!body) {
      setShown(errors);
      return;
    }
    change.mutate(
      draft.id
        ? { action: "updateCompensation", id: draft.id, body: { ...body, version: draft.version } }
        : { action: "createCompensation", body },
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
            error={error("date")}
            onChange={(e) => set({ date: e.currentTarget.value })}
            data-autofocus
          />
          <TextInput
            label={`${t("journal.amount")} (${bookCurrency})`}
            required
            inputMode="decimal"
            value={draft.amount}
            error={error("amount")}
            onChange={(e) => set({ amount: e.currentTarget.value })}
          />
        </Group>
        <Select
          label={t("compensation.plus")}
          required
          searchable
          data={plusOptions}
          value={draft.plusSubCategoryId}
          error={error("plusSubCategoryId")}
          onChange={(value) => set({ plusSubCategoryId: value })}
        />
        <Select
          label={t("compensation.minus")}
          required
          searchable
          data={minusOptions}
          value={draft.minusSubCategoryId}
          error={error("minusSubCategoryId")}
          onChange={(value) => set({ minusSubCategoryId: value })}
        />
        <TextInput
          label={t("journal.description")}
          maxLength={500}
          value={draft.description}
          onChange={(e) => set({ description: e.currentTarget.value })}
        />
        <Group justify="space-between">
          <Group gap="xs">
            {draft.id && (
              <>
                <Button
                  variant="subtle"
                  onClick={() =>
                    onDuplicate({ ...initial, id: undefined, version: undefined, date: today() })
                  }
                >
                  {t("journal.duplicate")}
                </Button>
                <Button
                  variant="subtle"
                  color="red"
                  loading={change.isPending && change.variables?.action === "deleteCompensation"}
                  onClick={() =>
                    window.confirm(t("compensation.deleteConfirm")) &&
                    change.mutate(
                      { action: "deleteCompensation", id: draft.id! },
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
 * Creates a compensation, or edits an existing one by its id (loaded here):
 * both of its journal entries change together.
 */
export function CompensationForm({
  bookId,
  bookCurrency,
  reference,
  compensationId,
  from,
  onClose,
  onDuplicate,
}: {
  bookId: string;
  bookCurrency: string;
  reference: Reference;
  compensationId?: string;
  /** What a new one starts from, when duplicating. */
  from?: CompensationDraft;
  onClose: () => void;
  /** Starts a new compensation from the saved one. */
  onDuplicate: (draft: CompensationDraft) => void;
}) {
  const { t } = useTranslation();
  const loaded = useCompensation(bookId, compensationId);
  if (compensationId !== undefined) {
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
