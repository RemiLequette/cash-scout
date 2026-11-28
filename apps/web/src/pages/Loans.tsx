import {
  formatMoney,
  insuranceModes,
  deferralModes,
  loanEventInputSchema,
  loanUpdateSchema,
  parseAmount,
  repaymentKeeps,
  type LoanEventInput,
} from "@cash-scout/domain";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { decimalInput, formatDate, formatDay, today } from "../journal";
import { useLoanChange, useLoans, useSchedule, type Loan, type LoanEventRow } from "../loans";
import { useNameOf, useReference, useSubCategoryOptions, type Reference } from "../reference";
import { DataTable } from "../table";

function ErrorAlert({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  return error ? <Alert color="red">{t("common.error", { message: error.message })}</Alert> : null;
}

function useMoney() {
  const { i18n } = useTranslation();
  return (amount: string, currency: string) =>
    formatMoney(parseAmount(amount, currency), i18n.language);
}

/** What the loan form edits: every field as typed. */
interface LoanDraft {
  id?: string;
  version?: number;
  name: string;
  lender: string;
  amount: string;
  rate: string;
  term: string;
  start: string;
  insuranceMode: string;
  insuranceRate: string;
  insuranceSeparate: boolean;
  insuranceAccountId: string | null;
  deferralMode: string;
  deferralMonths: string;
  accountId: string | null;
  capitalSubCategoryId: string | null;
  interestSubCategoryId: string | null;
  insuranceSubCategoryId: string | null;
  penaltySubCategoryId: string | null;
}

const emptyLoan = (): LoanDraft => ({
  name: "",
  lender: "",
  amount: "",
  rate: "",
  term: "",
  start: today(),
  insuranceMode: "none",
  insuranceRate: "",
  insuranceSeparate: false,
  insuranceAccountId: null,
  deferralMode: "none",
  deferralMonths: "",
  accountId: null,
  capitalSubCategoryId: null,
  interestSubCategoryId: null,
  insuranceSubCategoryId: null,
  penaltySubCategoryId: null,
});

const draftOf = (loan: Loan): LoanDraft => ({
  id: loan.id,
  version: loan.version,
  name: loan.name,
  lender: loan.lender,
  amount: loan.amount,
  rate: loan.rate,
  term: String(loan.term),
  start: loan.start,
  insuranceMode: loan.insuranceMode,
  insuranceRate: loan.insuranceMode === "none" ? "" : loan.insuranceRate,
  insuranceSeparate: loan.insuranceSeparate,
  insuranceAccountId: loan.insuranceAccountId,
  deferralMode: loan.deferralMode,
  deferralMonths: loan.deferralMonths === 0 ? "" : String(loan.deferralMonths),
  accountId: loan.accountId,
  capitalSubCategoryId: loan.capitalSubCategoryId,
  interestSubCategoryId: loan.interestSubCategoryId,
  insuranceSubCategoryId: loan.insuranceSubCategoryId,
  penaltySubCategoryId: loan.penaltySubCategoryId,
});

/** Checks the draft as the API will: the body, or the fields that are wrong. */
function validateLoan(draft: LoanDraft, currency: string | undefined) {
  const candidate = {
    name: draft.name,
    lender: draft.lender,
    amount: decimalInput(draft.amount),
    rate: decimalInput(draft.rate),
    term: Number(draft.term),
    start: draft.start,
    insuranceMode: draft.insuranceMode,
    insuranceRate: decimalInput(draft.insuranceRate) || "0",
    insuranceSeparate: draft.insuranceMode !== "none" && draft.insuranceSeparate,
    insuranceAccountId:
      draft.insuranceMode !== "none" && draft.insuranceSeparate ? draft.insuranceAccountId : null,
    deferralMode: draft.deferralMode,
    deferralMonths: draft.deferralMode === "none" ? 0 : Number(draft.deferralMonths),
    accountId: draft.accountId ?? "",
    capitalSubCategoryId: draft.capitalSubCategoryId ?? "",
    interestSubCategoryId: draft.interestSubCategoryId ?? "",
    insuranceSubCategoryId: draft.insuranceMode === "none" ? null : draft.insuranceSubCategoryId,
    penaltySubCategoryId: draft.penaltySubCategoryId,
  };
  const errors = new Set<string>();
  const parsed = loanUpdateSchema.safeParse({ ...candidate, version: draft.version });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.add(String(issue.path[0]));
  }
  if (currency) {
    try {
      parseAmount(candidate.amount, currency);
    } catch {
      errors.add("amount");
    }
  }
  return errors.size === 0 && parsed.success ? { body: parsed.data } : { errors };
}

function LoanForm({
  bookId,
  reference,
  initial,
  onClose,
  onSaved,
}: {
  bookId: string;
  reference: Reference;
  initial: LoanDraft;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const change = useLoanChange(bookId);
  const [draft, setDraft] = useState(initial);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const set = (patch: Partial<LoanDraft>) => setDraft({ ...draft, ...patch });
  const account = reference.accounts.find((a) => a.id === draft.accountId);
  const checked = validateLoan(draft, account?.currency);
  const error = (field: string) => (shown.has(field) ? t("loans.invalid") : undefined);

  // A loan's parts are counted in the totals: transfer categories are out.
  const transferNatures = new Set(reference.natures.filter((n) => n.transfer).map((n) => n.id));
  const counted = reference.categories
    .filter((c) => !transferNatures.has(c.natureId))
    .map((c) => c.id);
  const kept = (id: string | null) => (initial.id ? (id ?? undefined) : undefined);
  const capitalOptions = useSubCategoryOptions(
    reference,
    kept(initial.capitalSubCategoryId),
    counted,
  );
  const interestOptions = useSubCategoryOptions(
    reference,
    kept(initial.interestSubCategoryId),
    counted,
  );
  const penaltyOptions = useSubCategoryOptions(
    reference,
    kept(initial.penaltySubCategoryId),
    counted,
  );
  const insuranceOptions = useSubCategoryOptions(
    reference,
    kept(initial.insuranceSubCategoryId),
    counted,
  );

  const accounts = reference.accounts
    .filter((a) => !a.archived || a.id === initial.accountId)
    // The amounts of a loan are kept in its account's currency.
    .filter(
      (a) =>
        !initial.id ||
        a.currency === reference.accounts.find((x) => x.id === initial.accountId)?.currency,
    )
    .map((a) => ({ value: a.id, label: `${nameOf(a.names)} (${a.currency})` }));

  // A separate insurance is in the currency of the loan.
  const sameCurrency = reference.accounts
    .filter((a) => a.currency === account?.currency)
    .filter((a) => !a.archived || a.id === initial.insuranceAccountId)
    .map((a) => ({ value: a.id, label: nameOf(a.names) }));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!checked.body) {
      setShown(checked.errors);
      return;
    }
    const { version, ...body } = checked.body;
    change.mutate(
      draft.id
        ? { action: "update", id: draft.id, body: { ...body, version } }
        : { action: "create", body },
      { onSuccess: (saved) => (onSaved((saved as Loan).id), onClose()) },
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <ErrorAlert error={change.error} />
        <Group grow align="flex-start">
          <TextInput
            label={t("loans.name")}
            required
            maxLength={100}
            value={draft.name}
            error={error("name")}
            onChange={(e) => set({ name: e.currentTarget.value })}
            data-autofocus
          />
          <TextInput
            label={t("loans.lender")}
            maxLength={100}
            value={draft.lender}
            onChange={(e) => set({ lender: e.currentTarget.value })}
          />
        </Group>
        <Select
          label={t("loans.account")}
          required
          data={accounts}
          value={draft.accountId}
          error={error("accountId")}
          onChange={(value) => set({ accountId: value })}
        />
        <Group grow align="flex-start">
          <TextInput
            label={`${t("loans.amount")}${account ? ` (${account.currency})` : ""}`}
            required
            inputMode="decimal"
            value={draft.amount}
            error={error("amount")}
            onChange={(e) => set({ amount: e.currentTarget.value })}
          />
          <TextInput
            label={t("loans.rate")}
            required
            inputMode="decimal"
            value={draft.rate}
            error={error("rate")}
            onChange={(e) => set({ rate: e.currentTarget.value })}
          />
        </Group>
        <Group grow align="flex-start">
          <TextInput
            label={t("loans.term")}
            required
            inputMode="numeric"
            value={draft.term}
            error={error("term")}
            onChange={(e) => set({ term: e.currentTarget.value })}
          />
          <TextInput
            type="date"
            label={t("loans.start")}
            required
            value={draft.start}
            error={error("start")}
            onChange={(e) => set({ start: e.currentTarget.value })}
          />
        </Group>
        <Group grow align="flex-start">
          <Select
            label={t("loans.insurance")}
            allowDeselect={false}
            data={insuranceModes.map((mode) => ({
              value: mode,
              label: t(`loans.insuranceMode.${mode}`),
            }))}
            value={draft.insuranceMode}
            onChange={(value) => set({ insuranceMode: value ?? "none" })}
          />
          {draft.insuranceMode !== "none" && (
            <TextInput
              label={t("loans.insuranceRate")}
              required
              inputMode="decimal"
              value={draft.insuranceRate}
              error={error("insuranceRate")}
              onChange={(e) => set({ insuranceRate: e.currentTarget.value })}
            />
          )}
        </Group>
        {draft.insuranceMode !== "none" && (
          <Group grow align="flex-end">
            <Switch
              label={t("loans.insuranceSeparate")}
              checked={draft.insuranceSeparate}
              onChange={(e) => set({ insuranceSeparate: e.currentTarget.checked })}
            />
            {draft.insuranceSeparate && (
              <Select
                label={t("loans.insuranceAccount")}
                placeholder={t("loans.account")}
                clearable
                data={sameCurrency}
                value={draft.insuranceAccountId}
                onChange={(value) => set({ insuranceAccountId: value })}
              />
            )}
          </Group>
        )}
        <Group grow align="flex-start">
          <Select
            label={t("loans.deferral")}
            allowDeselect={false}
            data={deferralModes.map((mode) => ({
              value: mode,
              label: t(`loans.deferralMode.${mode}`),
            }))}
            value={draft.deferralMode}
            onChange={(value) => set({ deferralMode: value ?? "none" })}
          />
          {draft.deferralMode !== "none" && (
            <TextInput
              label={t("loans.deferralMonths")}
              required
              inputMode="numeric"
              value={draft.deferralMonths}
              error={error("deferralMonths")}
              onChange={(e) => set({ deferralMonths: e.currentTarget.value })}
            />
          )}
        </Group>
        <Select
          label={t("loans.capitalPart")}
          required
          searchable
          data={capitalOptions}
          value={draft.capitalSubCategoryId}
          error={error("capitalSubCategoryId")}
          onChange={(value) => set({ capitalSubCategoryId: value })}
        />
        <Select
          label={t("loans.interestPart")}
          required
          searchable
          data={interestOptions}
          value={draft.interestSubCategoryId}
          error={error("interestSubCategoryId")}
          onChange={(value) => set({ interestSubCategoryId: value })}
        />
        {draft.insuranceMode !== "none" && (
          <Select
            label={t("loans.insurancePart")}
            required
            searchable
            data={insuranceOptions}
            value={draft.insuranceSubCategoryId}
            error={error("insuranceSubCategoryId")}
            onChange={(value) => set({ insuranceSubCategoryId: value })}
          />
        )}
        <Select
          label={t("loans.penaltyPart")}
          searchable
          clearable
          data={penaltyOptions}
          value={draft.penaltySubCategoryId}
          onChange={(value) => set({ penaltySubCategoryId: value })}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={change.isPending}>
            {t("common.save")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** What the event form edits. */
interface EventDraft {
  id?: string;
  version?: number;
  date: string;
  kind: string;
  amount: string;
  keeps: string;
  insuranceMode: string;
  insuranceRate: string;
  insuranceSeparate: boolean;
  insuranceAccountId: string | null;
  penalty: string;
  note: string;
}

const draftOfEvent = (event: LoanEventRow): EventDraft => ({
  id: event.id,
  version: event.version,
  date: event.date,
  kind: event.kind,
  amount: event.amount ?? "",
  keeps: event.keeps,
  insuranceMode: event.insuranceMode ?? "remaining",
  insuranceRate: event.insuranceMode === "none" ? "" : (event.insuranceRate ?? ""),
  insuranceSeparate: event.insuranceSeparate,
  insuranceAccountId: event.insuranceAccountId,
  penalty: event.penalty ?? "",
  note: event.note,
});

const newEvent = (): EventDraft => ({
  date: today(),
  kind: "repayment",
  amount: "",
  keeps: "payment",
  insuranceMode: "remaining",
  insuranceRate: "",
  insuranceSeparate: false,
  insuranceAccountId: null,
  penalty: "",
  note: "",
});

function EventForm({
  bookId,
  loan,
  initial,
  onClose,
}: {
  bookId: string;
  loan: Loan;
  initial: EventDraft;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const change = useLoanChange(bookId);
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const set = (patch: Partial<EventDraft>) => setDraft({ ...draft, ...patch });
  const needsAmount = draft.kind === "drawdown" || draft.kind === "repayment";
  const insurer = draft.kind === "insurance";
  const reference = useReference(bookId);
  const nameOf = useNameOf(reference.data?.defaultLanguage);
  const accounts = (reference.data?.accounts ?? [])
    .filter((a) => a.currency === loan.currency)
    .filter((a) => !a.archived || a.id === initial.insuranceAccountId)
    .map((a) => ({ value: a.id, label: nameOf(a.names) }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const amount = decimalInput(draft.amount);
    const candidate = {
      date: draft.date,
      kind: draft.kind,
      amount: needsAmount && amount !== "" ? amount : null,
      keeps: draft.keeps,
      insuranceMode: insurer ? draft.insuranceMode : null,
      insuranceRate: decimalInput(draft.insuranceRate) || "0",
      insuranceSeparate: insurer && draft.insuranceMode !== "none" && draft.insuranceSeparate,
      insuranceAccountId:
        insurer && draft.insuranceMode !== "none" && draft.insuranceSeparate
          ? draft.insuranceAccountId
          : null,
      penalty:
        draft.kind === "repayment" || draft.kind === "buyback"
          ? decimalInput(draft.penalty) || null
          : null,
      note: draft.note,
      version: draft.version,
    };
    const parsed = loanEventInputSchema.safeParse(candidate);
    let fits = parsed.success;
    try {
      if (parsed.success && parsed.data.amount) parseAmount(parsed.data.amount, loan.currency);
    } catch {
      fits = false;
    }
    if (!parsed.success || !fits) {
      setInvalid(true);
      return;
    }
    const body: LoanEventInput = parsed.data;
    change.mutate(
      draft.id
        ? { action: "updateEvent", id: loan.id, eventId: draft.id, body }
        : { action: "createEvent", id: loan.id, body },
      { onSuccess: onClose },
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <ErrorAlert error={change.error} />
        <Select
          label={t("loans.eventKind")}
          allowDeselect={false}
          data={(["drawdown", "repayment", "buyback", "insurance"] as const).map((kind) => ({
            value: kind,
            label: t(`loans.event.${kind}`),
          }))}
          value={draft.kind}
          onChange={(value) => set({ kind: value ?? "repayment" })}
        />
        <Group grow align="flex-start">
          <TextInput
            type="date"
            label={t("journal.date")}
            required
            value={draft.date}
            onChange={(e) => set({ date: e.currentTarget.value })}
            data-autofocus
          />
          {needsAmount && (
            <TextInput
              label={`${t("loans.eventAmount")} (${loan.currency})`}
              required={draft.kind === "drawdown"}
              placeholder={draft.kind === "repayment" ? t("loans.allRemaining") : undefined}
              inputMode="decimal"
              value={draft.amount}
              error={
                invalid && draft.kind === "drawdown" && !draft.amount
                  ? t("loans.invalid")
                  : undefined
              }
              onChange={(e) => set({ amount: e.currentTarget.value })}
            />
          )}
        </Group>
        {(draft.kind === "repayment" || draft.kind === "buyback") && (
          <TextInput
            label={`${t("loans.penalty")} (${loan.currency})`}
            inputMode="decimal"
            value={draft.penalty}
            onChange={(e) => set({ penalty: e.currentTarget.value })}
          />
        )}
        {insurer && (
          <>
            <Group grow align="flex-start">
              <Select
                label={t("loans.insurance")}
                allowDeselect={false}
                data={insuranceModes.map((mode) => ({
                  value: mode,
                  label: t(`loans.insuranceMode.${mode}`),
                }))}
                value={draft.insuranceMode}
                onChange={(value) => set({ insuranceMode: value ?? "none" })}
              />
              {draft.insuranceMode !== "none" && (
                <TextInput
                  label={t("loans.insuranceRate")}
                  required
                  inputMode="decimal"
                  value={draft.insuranceRate}
                  error={invalid && !draft.insuranceRate ? t("loans.invalid") : undefined}
                  onChange={(e) => set({ insuranceRate: e.currentTarget.value })}
                />
              )}
            </Group>
            {draft.insuranceMode !== "none" && (
              <Group grow align="flex-end">
                <Switch
                  label={t("loans.insuranceSeparate")}
                  checked={draft.insuranceSeparate}
                  onChange={(e) => set({ insuranceSeparate: e.currentTarget.checked })}
                />
                {draft.insuranceSeparate && (
                  <Select
                    label={t("loans.insuranceAccount")}
                    placeholder={t("loans.account")}
                    clearable
                    data={accounts}
                    value={draft.insuranceAccountId}
                    onChange={(value) => set({ insuranceAccountId: value })}
                  />
                )}
              </Group>
            )}
          </>
        )}
        {draft.kind === "repayment" && (
          <Select
            label={t("loans.keeps")}
            allowDeselect={false}
            data={repaymentKeeps.map((keeps) => ({
              value: keeps,
              label: t(`loans.keepsOption.${keeps}`),
            }))}
            value={draft.keeps}
            onChange={(value) => set({ keeps: value ?? "payment" })}
          />
        )}
        <TextInput
          label={t("loans.note")}
          maxLength={300}
          value={draft.note}
          onChange={(e) => set({ note: e.currentTarget.value })}
        />
        {invalid && !change.error && (
          <Text c="red" size="sm">
            {t("loans.invalid")}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={change.isPending}>
            {t("common.save")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function Events({ bookId, loan, canEdit }: { bookId: string; loan: Loan; canEdit: boolean }) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const change = useLoanChange(bookId);
  const [editing, setEditing] = useState<EventDraft | null>(null);
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Title order={5}>{t("loans.events")}</Title>
        {canEdit && (
          <Button size="compact-sm" variant="light" onClick={() => setEditing(newEvent())}>
            {t("loans.addEvent")}
          </Button>
        )}
      </Group>
      <ErrorAlert error={change.error} />
      {loan.events.length > 0 && (
        <DataTable minWidth={500}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("journal.date")}</Table.Th>
              <Table.Th>{t("loans.eventKind")}</Table.Th>
              <Table.Th ta="right">{t("loans.eventAmount")}</Table.Th>
              <Table.Th>{t("loans.keeps")}</Table.Th>
              <Table.Th>{t("loans.note")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loan.events.map((event) => (
              <Table.Tr key={event.id}>
                <Table.Td>{formatDate(event.date, i18n.language)}</Table.Td>
                <Table.Td>{t(`loans.event.${event.kind}`)}</Table.Td>
                <Table.Td ta="right">
                  {event.kind === "insurance"
                    ? `${t(`loans.insuranceMode.${event.insuranceMode ?? "none"}`)}${event.insuranceMode === "none" ? "" : ` · ${event.insuranceRate} %`}`
                    : event.amount === null
                      ? t("loans.allRemaining")
                      : money(event.amount, loan.currency)}
                </Table.Td>
                <Table.Td>
                  {[
                    event.kind === "repayment" && event.amount !== null
                      ? t(`loans.keepsOption.${event.keeps}`)
                      : event.kind === "insurance" && event.insuranceSeparate
                        ? t("loans.insuranceApart")
                        : "",
                    event.penalty
                      ? `${t("loans.penalty")} ${money(event.penalty, loan.currency)}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Table.Td>
                <Table.Td>{event.note}</Table.Td>
                <Table.Td>
                  {canEdit && (
                    <Group gap="xs" justify="flex-end" wrap="nowrap">
                      <Button
                        size="compact-sm"
                        variant="subtle"
                        onClick={() => setEditing(draftOfEvent(event))}
                      >
                        {t("loans.edit")}
                      </Button>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={t("common.delete")}
                        onClick={() =>
                          window.confirm(t("loans.deleteEventConfirm")) &&
                          change.mutate({ action: "deleteEvent", id: loan.id, eventId: event.id })
                        }
                      >
                        ✕
                      </ActionIcon>
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </DataTable>
      )}
      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? t("loans.editEvent") : t("loans.addEvent")}
      >
        {editing && (
          <EventForm
            bookId={bookId}
            loan={loan}
            initial={editing}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
    </Stack>
  );
}

function Schedule({
  bookId,
  bookCurrency,
  loan,
  canEdit,
}: {
  bookId: string;
  bookCurrency: string;
  loan: Loan;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const schedule = useSchedule(bookId, loan.id);
  const change = useLoanChange(bookId);
  const first = Number(loan.start.slice(0, 4));
  const last = Number((loan.end ?? loan.start).slice(0, 4));
  const now = new Date().getFullYear();
  const [year, setYear] = useState(String(Math.min(Math.max(now, first), last)));
  const [rate, setRate] = useState("");
  const years = Array.from({ length: Math.max(last - first + 1, 1) }, (_, i) => String(first + i));
  const lines = (schedule.data?.lines ?? []).filter((line) => line.date.startsWith(`${year}-`));
  const foreign = loan.currency !== bookCurrency;
  const result = change.data as { created: number; replaced: number; removed: number } | undefined;

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="flex-end">
        <Title order={5}>{t("loans.schedule")}</Title>
        <Group align="flex-end" gap="xs">
          <Select
            aria-label={t("loans.year")}
            w={100}
            allowDeselect={false}
            data={years}
            value={year}
            onChange={(value) => value && setYear(value)}
          />
          {canEdit && foreign && (
            <TextInput
              aria-label={t("journal.exchangeRate")}
              placeholder={t("journal.exchangeRate")}
              w={120}
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.currentTarget.value)}
            />
          )}
          {canEdit && (
            <Button
              variant="light"
              loading={change.isPending && change.variables?.action === "plan"}
              onClick={() =>
                change.mutate({
                  action: "plan",
                  id: loan.id,
                  year: Number(year),
                  exchangeRate: foreign ? decimalInput(rate) : undefined,
                })
              }
            >
              {t("loans.plan", { year })}
            </Button>
          )}
        </Group>
      </Group>
      <ErrorAlert error={schedule.error ?? change.error} />
      {result && change.variables?.action === "plan" && (
        <Alert color="green">{t("loans.planned", result)}</Alert>
      )}
      <DataTable minWidth={760}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("journal.date")}</Table.Th>
            <Table.Th ta="right">{t("loans.number")}</Table.Th>
            <Table.Th ta="right">{t("loans.capital")}</Table.Th>
            <Table.Th ta="right">{t("loans.interest")}</Table.Th>
            <Table.Th ta="right">{t("loans.insuranceColumn")}</Table.Th>
            <Table.Th ta="right">{t("loans.penalty")}</Table.Th>
            <Table.Th ta="right">{t("loans.total")}</Table.Th>
            <Table.Th ta="right">{t("loans.remaining")}</Table.Th>
            <Table.Th>{t("loans.journal")}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {lines.map((line, index) => (
            <Table.Tr key={`${line.date}-${line.kind}-${index}`}>
              <Table.Td style={{ whiteSpace: "nowrap" }}>
                {formatDay(line.date, i18n.language)}
              </Table.Td>
              <Table.Td ta="right">
                {line.kind === "payment" ? line.number : t(`loans.event.${line.kind}`)}
              </Table.Td>
              <Table.Td ta="right">{money(line.capital, loan.currency)}</Table.Td>
              <Table.Td ta="right">{money(line.interest, loan.currency)}</Table.Td>
              <Table.Td ta="right">
                {line.insuranceSeparate && line.insurance !== "0.00" ? (
                  <Tooltip label={t("loans.insuranceApart")}>
                    <Text span c="dimmed" size="sm">
                      {money(line.insurance, loan.currency)} ↗
                    </Text>
                  </Tooltip>
                ) : (
                  money(line.insurance, loan.currency)
                )}
              </Table.Td>
              <Table.Td ta="right">
                {line.penalty !== "0.00" && (
                  <Text span c="dimmed" size="sm">
                    {money(line.penalty, loan.currency)} ↗
                  </Text>
                )}
              </Table.Td>
              <Table.Td ta="right">{money(line.total, loan.currency)}</Table.Td>
              <Table.Td ta="right">{money(line.remaining, loan.currency)}</Table.Td>
              <Table.Td>
                <Group gap={4} wrap="nowrap">
                  {line.journal && (
                    <Badge variant="light" color={line.journal === "reconciled" ? "green" : "blue"}>
                      {t(`loans.inJournal.${line.journal}`)}
                    </Badge>
                  )}
                  {line.penaltyJournal && (
                    <Tooltip label={t("loans.penalty")}>
                      <Badge
                        variant="outline"
                        color={line.penaltyJournal === "reconciled" ? "green" : "blue"}
                      >
                        {t(`loans.inJournal.${line.penaltyJournal}`)} ↗
                      </Badge>
                    </Tooltip>
                  )}
                  {line.insuranceJournal && (
                    <Tooltip label={t("loans.insuranceApart")}>
                      <Badge
                        variant="outline"
                        color={line.insuranceJournal === "reconciled" ? "green" : "blue"}
                      >
                        {t(`loans.inJournal.${line.insuranceJournal}`)} ↗
                      </Badge>
                    </Tooltip>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </DataTable>
    </Stack>
  );
}

function LoanDetail({
  bookId,
  bookCurrency,
  loan,
  canEdit,
  onEdit,
  onDeleted,
}: {
  bookId: string;
  bookCurrency: string;
  loan: Loan;
  canEdit: boolean;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const change = useLoanChange(bookId);
  const check = loan.check;
  return (
    <Paper withBorder p="md">
      <Stack>
        <Group justify="space-between">
          <Title order={4}>{loan.name}</Title>
          {canEdit && (
            <Group gap="xs">
              <Button variant="default" size="compact-sm" onClick={onEdit}>
                {t("loans.edit")}
              </Button>
              <Button
                variant="subtle"
                color="red"
                size="compact-sm"
                loading={change.isPending && change.variables?.action === "delete"}
                onClick={() =>
                  window.confirm(t("loans.deleteConfirm", { name: loan.name })) &&
                  change.mutate({ action: "delete", id: loan.id }, { onSuccess: onDeleted })
                }
              >
                {t("common.delete")}
              </Button>
            </Group>
          )}
        </Group>
        <ErrorAlert error={change.error} />
        {loan.effectiveRate.withInsurance && (
          <Text size="sm" c="dimmed">
            {loan.effectiveRate.withInsurance === loan.effectiveRate.withoutInsurance
              ? t("loans.effectiveRateSame", { rate: loan.effectiveRate.withInsurance })
              : t("loans.effectiveRateText", {
                  withInsurance: loan.effectiveRate.withInsurance,
                  withoutInsurance: loan.effectiveRate.withoutInsurance,
                })}
          </Text>
        )}
        {check?.flagged && (
          <Alert color="orange" title={t("loans.gap")}>
            {t("loans.gapText", {
              from: check.from,
              to: check.to,
              journal: money(check.journal, loan.currency),
              schedule: money(check.schedule, loan.currency),
              gap: money(check.gap, loan.currency),
            })}
            {check.loans > 1 && ` ${t("loans.gapShared", { count: check.loans })}`}
          </Alert>
        )}
        <Events bookId={bookId} loan={loan} canEdit={canEdit} />
        <Schedule bookId={bookId} bookCurrency={bookCurrency} loan={loan} canEdit={canEdit} />
      </Stack>
    </Paper>
  );
}

/** The loans of a book: their terms and events, their schedule, and the payments planned from it. */
export function Loans({
  bookId,
  bookCurrency,
  canEdit,
}: {
  bookId: string;
  bookCurrency: string;
  canEdit: boolean;
}) {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const reference = useReference(bookId);
  const [date, setDate] = useState(today());
  const loans = useLoans(bookId, date);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<LoanDraft | null>(null);
  const loan = loans.data?.find((l) => l.id === selected) ?? loans.data?.[0];

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <Title order={3}>{t("loans.title")}</Title>
        <Group align="flex-end">
          <TextInput
            type="date"
            label={t("loans.remainingAt")}
            value={date}
            onChange={(e) => e.currentTarget.value && setDate(e.currentTarget.value)}
          />
          {canEdit && (
            <Button onClick={() => setEditing(emptyLoan())} disabled={!reference.data}>
              {t("loans.new")}
            </Button>
          )}
        </Group>
      </Group>
      <ErrorAlert error={loans.error ?? reference.error} />
      {loans.data?.length === 0 && <Text c="dimmed">{t("loans.none")}</Text>}
      {loans.data && loans.data.length > 0 && (
        <DataTable minWidth={800} highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("loans.name")}</Table.Th>
              <Table.Th ta="right">{t("loans.amount")}</Table.Th>
              <Table.Th ta="right">{t("loans.rateColumn")}</Table.Th>
              <Table.Th ta="right">{t("loans.effectiveRate")}</Table.Th>
              <Table.Th>{t("loans.nextPayment")}</Table.Th>
              <Table.Th>{t("loans.end")}</Table.Th>
              <Table.Th ta="right">{t("loans.remaining")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {loans.data.map((row) => (
              <Table.Tr
                key={row.id}
                style={{ cursor: "pointer" }}
                bg={row.id === loan?.id ? "var(--mantine-color-blue-light)" : undefined}
                onClick={() => setSelected(row.id)}
              >
                <Table.Td>
                  {row.name}
                  {row.lender && (
                    <Text span c="dimmed">
                      {" · "}
                      {row.lender}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td ta="right">{money(row.amount, row.currency)}</Table.Td>
                <Table.Td ta="right">{row.rate} %</Table.Td>
                <Table.Td ta="right">
                  {row.effectiveRate.withInsurance ? `${row.effectiveRate.withInsurance} %` : ""}
                </Table.Td>
                <Table.Td>
                  {row.nextPayment
                    ? `${formatDate(row.nextPayment.date, i18n.language)} · ${money(row.nextPayment.total, row.currency)}`
                    : ""}
                </Table.Td>
                <Table.Td>{row.end ? formatDate(row.end, i18n.language) : ""}</Table.Td>
                <Table.Td ta="right">{money(row.remaining, row.currency)}</Table.Td>
                <Table.Td>
                  {row.check?.flagged && (
                    <Tooltip label={t("loans.gap")}>
                      <Badge color="orange" variant="light">
                        {t("loans.gap")}
                      </Badge>
                    </Tooltip>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </DataTable>
      )}
      {loan && (
        <LoanDetail
          key={loan.id}
          bookId={bookId}
          bookCurrency={bookCurrency}
          loan={loan}
          canEdit={canEdit}
          onEdit={() => setEditing(draftOf(loan))}
          onDeleted={() => setSelected(null)}
        />
      )}
      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? t("loans.editLoan") : t("loans.new")}
        size="lg"
      >
        {editing && reference.data && (
          <LoanForm
            bookId={bookId}
            reference={reference.data}
            initial={editing}
            onClose={() => setEditing(null)}
            onSaved={setSelected}
          />
        )}
      </Modal>
    </Stack>
  );
}
