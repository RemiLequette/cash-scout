import {
  consumptionModes,
  formatMoney,
  money,
  parseAmount,
  raise,
  toDecimalString,
  type BudgetType,
  type ConsumptionMode,
} from "@cash-scout/domain";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "../api";
import {
  useBudgetProfiles,
  useBudgetYear,
  type BudgetProfile,
  type BudgetYear,
  type CategoryBudgetRow,
} from "../budget";
import { useNameOf, useReference, type Reference } from "../reference";

// ---------------------------------------------------------------------------
// Drafts: what the page edits, one per category
// ---------------------------------------------------------------------------

interface Draft {
  type: BudgetType;
  /** Annual amount as typed, in the book currency (periodic). */
  amount: string;
  profileId: string | null;
  consumption: ConsumptionMode;
  accountId: string | null;
  exchangeRate: string;
  assumptions: string;
  /** The category has a budget row (saved, or kept when it is a scheduled one). */
  existed: boolean;
}

type Category = Reference["categories"][number];

function blankDraft(category: Category, profiles: BudgetProfile[]): Draft {
  return {
    type: category.defaultBudgetType,
    amount: "",
    profileId: profiles.find((p) => !p.archived)?.id ?? null,
    consumption: "lapse",
    accountId: null,
    exchangeRate: "",
    assumptions: "",
    existed: false,
  };
}

function draftOf(budget: CategoryBudgetRow): Draft {
  return {
    type: budget.type,
    amount: budget.amount ?? "",
    profileId: budget.profileId,
    consumption: budget.consumption ?? "lapse",
    accountId: budget.accountId,
    exchangeRate: budget.exchangeRate ?? "",
    assumptions: budget.assumptions,
    existed: true,
  };
}

/** Whether the draft is a budget to keep, as opposed to a category left to its default. */
function isPlanned(draft: Draft, category: Category): boolean {
  return draft.type === "periodic"
    ? draft.amount.trim() !== ""
    : draft.existed || draft.type !== category.defaultBudgetType || draft.assumptions.trim() !== "";
}

/** The parts of a draft that make up a budget; `existed` is bookkeeping. */
function sameBudget(a: Draft, b: Draft): boolean {
  if (a.type !== b.type || a.assumptions.trim() !== b.assumptions.trim()) return false;
  if (a.type === "scheduled") return true;
  return (
    a.amount.trim() === b.amount.trim() &&
    a.profileId === b.profileId &&
    a.consumption === b.consumption &&
    a.accountId === b.accountId &&
    (a.accountId === null || a.exchangeRate.trim() === b.exchangeRate.trim())
  );
}

/** The request body of a planned draft. */
function inputOf(categoryId: string, year: number, draft: Draft) {
  const assumptions = draft.assumptions.trim();
  if (draft.type === "scheduled")
    return { categoryId, year, type: "scheduled" as const, assumptions };
  return {
    categoryId,
    year,
    type: "periodic" as const,
    assumptions,
    amount: draft.amount.trim(),
    profileId: draft.profileId ?? undefined,
    consumption: draft.consumption,
    ...(draft.accountId && {
      accountId: draft.accountId,
      ...(draft.exchangeRate.trim() !== "" && { exchangeRate: draft.exchangeRate.trim() }),
    }),
  };
}

type Account = Reference["accounts"][number];

/** What is wrong with a planned periodic draft, if anything, as a translation key. */
function problemOf(
  draft: Draft,
  category: Category,
  accounts: Account[],
  bookCurrency: string,
): string | undefined {
  if (!isPlanned(draft, category) || draft.type === "scheduled") return undefined;
  let minor: bigint;
  try {
    minor = parseAmount(draft.amount, bookCurrency).minor;
  } catch {
    return "budget.problemAmount";
  }
  if (minor < 0n && category.direction !== "saving") return "budget.problemNegative";
  if (!draft.profileId) return "budget.problemProfile";
  const account = accounts.find((a) => a.id === draft.accountId);
  if (account && account.currency !== bookCurrency && draft.exchangeRate.trim() === "") {
    return "budget.problemRate";
  }
  return undefined;
}

/** An amount typed or read as text, in minor units of the book currency; 0 when empty or invalid. */
function minorOf(text: string, currency: string): bigint {
  try {
    return parseAmount(text, currency).minor;
  } catch {
    return 0n;
  }
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function BudgetPage({
  bookId,
  bookCurrency,
  canEdit,
}: {
  bookId: string;
  bookCurrency: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const [year, setYear] = useState(new Date().getFullYear());
  const [reload, setReload] = useState(0);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const reference = useReference(bookId);
  const profiles = useBudgetProfiles(bookId);
  const current = useBudgetYear(bookId, year);
  const previous = useBudgetYear(bookId, year - 1);

  const failure = reference.error ?? profiles.error ?? current.error ?? previous.error;
  return (
    <Stack>
      <Group justify="space-between">
        <Group gap="xs">
          <ActionIcon
            variant="default"
            aria-label={t("budget.previousYear")}
            onClick={() => setYear(year - 1)}
          >
            ◀
          </ActionIcon>
          <Title order={3}>{t("budget.title", { year })}</Title>
          <ActionIcon
            variant="default"
            aria-label={t("budget.nextYear")}
            onClick={() => setYear(year + 1)}
          >
            ▶
          </ActionIcon>
        </Group>
        <Button variant="default" onClick={() => setProfilesOpen(true)}>
          {t("budget.profiles")}
        </Button>
      </Group>
      {failure && <Alert color="red">{t("common.error", { message: failure.message })}</Alert>}
      {reference.data && profiles.data && current.data && previous.data && (
        <BudgetEditor
          key={`${year}|${reload}`}
          bookId={bookId}
          bookCurrency={bookCurrency}
          canEdit={canEdit}
          year={year}
          reference={reference.data}
          profiles={profiles.data}
          current={current.data}
          previous={previous.data}
          onReload={() => setReload(reload + 1)}
        />
      )}
      {reference.data && profiles.data && (
        <Modal
          opened={profilesOpen}
          onClose={() => setProfilesOpen(false)}
          title={t("budget.profiles")}
          size="lg"
        >
          <ProfilesPanel
            bookId={bookId}
            defaultLanguage={reference.data.defaultLanguage}
            profiles={profiles.data}
            canEdit={canEdit}
          />
        </Modal>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// The table of a year
// ---------------------------------------------------------------------------

/** A signature of the saved budgets: it changes when someone else saves. */
const signatureOf = (budgets: CategoryBudgetRow[]) =>
  budgets.map((b) => `${b.id}:${b.version}`).join("|");

function BudgetEditor({
  bookId,
  bookCurrency,
  canEdit,
  year,
  reference,
  profiles,
  current,
  previous,
  onReload,
}: {
  bookId: string;
  bookCurrency: string;
  canEdit: boolean;
  year: number;
  reference: Reference;
  profiles: BudgetProfile[];
  current: BudgetYear;
  previous: BudgetYear;
  onReload: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const nameOf = useNameOf(reference.defaultLanguage);

  const categories = reference.categories.filter((c) => !c.archived);
  const savedBy = new Map(current.budgets.map((b) => [b.categoryId, b]));
  const previousBy = new Map(previous.budgets.map((b) => [b.categoryId, b]));
  const previousActual = new Map(previous.actuals.map((a) => [a.categoryId, a.total]));
  const entriesOf = new Map(current.actuals.map((a) => [a.categoryId, a.total]));

  const initial = (category: Category) => {
    const saved = savedBy.get(category.id);
    return saved ? draftOf(saved) : blankDraft(category, profiles);
  };
  const [drafts, setDrafts] = useState(
    () => new Map(categories.map((c) => [c.id, initial(c)] as const)),
  );
  const [open, setOpen] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  // The budgets as they were when the page was opened, to notice other people's changes.
  const [baseline] = useState(() => signatureOf(current.budgets));
  const draftOfCategory = (c: Category) => drafts.get(c.id) ?? initial(c);

  const changed = categories.filter((c) => {
    const draft = draftOfCategory(c);
    const saved = savedBy.get(c.id);
    const planned = isPlanned(draft, c);
    return saved ? !planned || !sameBudget(draftOf(saved), draft) : planned;
  });
  const problems = categories.filter((c) =>
    problemOf(draftOfCategory(c), c, reference.accounts, bookCurrency),
  );
  const dirty = changed.length > 0;
  const staleElsewhere = signatureOf(current.budgets) !== baseline;

  const save = useMutation({
    mutationFn: () => {
      const toSave = changed.filter((c) => isPlanned(draftOfCategory(c), c));
      const toRemove = changed.filter((c) => !isPlanned(draftOfCategory(c), c));
      return unwrap(
        api.books[":bookId"].budgets.batch.$post({
          param: { bookId },
          json: {
            year,
            save: toSave.map((c) => inputOf(c.id, year, draftOfCategory(c))),
            remove: toRemove.map((c) => c.id),
            versions: Object.fromEntries(
              changed.flatMap((c) => {
                const saved = savedBy.get(c.id);
                return saved ? [[c.id, saved.version] as const] : [];
              }),
            ),
          },
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["books", bookId, "budgets"] });
      onReload();
    },
  });

  function update(category: Category, patch: Partial<Draft>) {
    setDrafts((previousDrafts) =>
      new Map(previousDrafts).set(category.id, { ...draftOfCategory(category), ...patch }),
    );
  }
  const copyFromPrevious = (category: Category, percent = 0) => {
    const budget = previousBy.get(category.id);
    const actual = previousActual.get(category.id);
    const raised = (text: string) =>
      toDecimalString(
        money(raise(minorOf(text, bookCurrency), Math.round(percent * 100)), bookCurrency),
      );
    if (budget) {
      const draft = draftOf(budget);
      update(category, {
        ...draft,
        existed: savedBy.has(category.id),
        amount: draft.amount === "" ? "" : raised(draft.amount),
      });
    } else if (
      actual &&
      category.defaultBudgetType === "periodic" &&
      minorOf(actual, bookCurrency) !== 0n
    ) {
      update(category, { type: "periodic", amount: raised(actual) });
    }
  };
  const startFromPrevious = (percent: number) => {
    for (const category of categories) {
      if (!isPlanned(draftOfCategory(category), category)) copyFromPrevious(category, percent);
    }
  };

  const groups = [...reference.groups]
    .filter((g) => !g.archived)
    .sort((a, b) => a.position - b.position);
  const text = (minor: bigint) => formatMoney(money(minor, bookCurrency), i18n.language);
  const show = (value: string | undefined) =>
    value === undefined ? "–" : text(minorOf(value, bookCurrency));

  // The year's plan, and last year's reality, by direction.
  const totals = { income: 0n, expense: 0n, saving: 0n };
  const lastYear = { income: 0n, expense: 0n, saving: 0n };
  for (const category of categories) {
    const bucket = category.direction === "transfer" ? undefined : category.direction;
    if (!bucket) continue;
    const draft = draftOfCategory(category);
    totals[bucket] +=
      draft.type === "periodic"
        ? isPlanned(draft, category)
          ? minorOf(draft.amount, bookCurrency)
          : 0n
        : minorOf(entriesOf.get(category.id) ?? "0", bookCurrency);
    lastYear[bucket] += minorOf(previousActual.get(category.id) ?? "0", bookCurrency);
  }
  const change = (v: typeof totals) => v.income - v.expense - v.saving;

  const profileOptions = profiles
    .filter((p) => !p.archived)
    .map((p) => ({ value: p.id, label: nameOf(p.names) }));
  const accountOptions = reference.accounts
    .filter((a) => !a.archived && a.kind === "bank")
    .map((a) => ({ value: a.id, label: `${nameOf(a.names)} (${a.currency})` }));
  const consumptionOptions = consumptionModes.map((m) => ({
    value: m,
    label: t(`budget.consumption.${m}`),
  }));

  return (
    <Stack>
      {staleElsewhere && (
        <Alert color="yellow">
          <Group justify="space-between">
            <Text size="sm">{t("budget.changedElsewhere")}</Text>
            <Button size="xs" variant="default" onClick={onReload}>
              {t("budget.reload")}
            </Button>
          </Group>
        </Alert>
      )}
      {save.error && (
        <Alert color="red">{t("common.error", { message: save.error.message })}</Alert>
      )}
      {profiles.filter((p) => !p.archived).length === 0 && (
        <Alert color="blue">{t("budget.noProfile")}</Alert>
      )}
      {canEdit && (
        <Group justify="space-between">
          <Button variant="default" onClick={() => setStartOpen(true)}>
            {t("budget.startFrom", { year: year - 1 })}
          </Button>
          <Group>
            {problems.length > 0 && (
              <Text size="sm" c="red">
                {t("budget.problems", { count: problems.length })}
              </Text>
            )}
            <Button
              disabled={!dirty || problems.length > 0}
              loading={save.isPending}
              onClick={() => save.mutate()}
            >
              {t("common.save")}
            </Button>
          </Group>
        </Group>
      )}
      <Paper withBorder p="sm">
        <Table.ScrollContainer minWidth={1000}>
          <Table verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("budget.category")}</Table.Th>
                <Table.Th w={150}>{t("budget.type")}</Table.Th>
                <Table.Th w={110} ta="right">
                  {t("budget.actualOf", { year: year - 1 })}
                </Table.Th>
                <Table.Th w={110} ta="right">
                  {t("budget.plannedOf", { year: year - 1 })}
                </Table.Th>
                <Table.Th w={130}>{t("budget.amount")}</Table.Th>
                <Table.Th w={150}>{t("budget.profile")}</Table.Th>
                <Table.Th w={140}>{t("budget.consumptionLabel")}</Table.Th>
                <Table.Th w={110} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {groups.map((group) => {
                const rows = categories
                  .filter((c) => c.groupId === group.id)
                  .sort((a, b) => a.code.localeCompare(b.code));
                if (rows.length === 0) return null;
                return [
                  <Table.Tr key={group.id}>
                    <Table.Td colSpan={8} bg="var(--mantine-color-gray-light)">
                      <Text fw={600}>{nameOf(group.names)}</Text>
                    </Table.Td>
                  </Table.Tr>,
                  ...rows.flatMap((category) => {
                    const draft = draftOfCategory(category);
                    const planned = isPlanned(draft, category);
                    const problem = problemOf(draft, category, reference.accounts, bookCurrency);
                    const previousBudget = previousBy.get(category.id);
                    const isOpen = open === category.id;
                    const account = reference.accounts.find((a) => a.id === draft.accountId);
                    const needsRate = account !== undefined && account.currency !== bookCurrency;
                    return [
                      <Table.Tr key={category.id}>
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap">
                            <Badge variant="light" style={{ flexShrink: 0 }}>
                              {category.code}
                            </Badge>
                            <Text size="sm">{nameOf(category.names)}</Text>
                            <Badge size="xs" variant="dot" style={{ flexShrink: 0 }}>
                              {t(`directions.${category.direction}`)}
                            </Badge>
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <SegmentedControl
                            size="xs"
                            disabled={!canEdit}
                            value={draft.type}
                            onChange={(value) => update(category, { type: value as BudgetType })}
                            data={[
                              { value: "periodic", label: t("budget.periodic") },
                              { value: "scheduled", label: t("budget.scheduled") },
                            ]}
                          />
                        </Table.Td>
                        <Table.Td ta="right">{show(previousActual.get(category.id))}</Table.Td>
                        <Table.Td ta="right">
                          {previousBudget?.amount != null
                            ? show(previousBudget.amount)
                            : previousBudget
                              ? t("budget.scheduled")
                              : "–"}
                        </Table.Td>
                        {draft.type === "periodic" ? (
                          <>
                            <Table.Td>
                              <TextInput
                                size="xs"
                                aria-label={t("budget.amount")}
                                disabled={!canEdit}
                                inputMode="decimal"
                                value={draft.amount}
                                error={
                                  problem === "budget.problemAmount" ||
                                  problem === "budget.problemNegative"
                                }
                                onChange={(e) =>
                                  update(category, { amount: e.currentTarget.value })
                                }
                                styles={{ input: { textAlign: "right" } }}
                              />
                            </Table.Td>
                            <Table.Td>
                              <Select
                                size="xs"
                                aria-label={t("budget.profile")}
                                disabled={!canEdit}
                                data={profileOptions}
                                value={draft.profileId}
                                allowDeselect={false}
                                error={problem === "budget.problemProfile"}
                                onChange={(value) => update(category, { profileId: value })}
                              />
                            </Table.Td>
                            <Table.Td>
                              <Select
                                size="xs"
                                aria-label={t("budget.consumptionLabel")}
                                disabled={!canEdit}
                                data={consumptionOptions}
                                value={draft.consumption}
                                allowDeselect={false}
                                onChange={(value) =>
                                  value &&
                                  update(category, { consumption: value as ConsumptionMode })
                                }
                              />
                            </Table.Td>
                          </>
                        ) : (
                          <Table.Td colSpan={3}>
                            <Text size="sm" c="dimmed">
                              {t("budget.entriesOf", {
                                amount: show(entriesOf.get(category.id) ?? "0"),
                              })}
                            </Text>
                          </Table.Td>
                        )}
                        <Table.Td>
                          <Group gap={2} wrap="nowrap" justify="flex-end">
                            <Tooltip label={t("budget.details")}>
                              <ActionIcon
                                variant={isOpen ? "light" : "subtle"}
                                aria-label={t("budget.details")}
                                onClick={() => setOpen(isOpen ? null : category.id)}
                              >
                                ⋯
                              </ActionIcon>
                            </Tooltip>
                            {canEdit && (
                              <Tooltip label={t("budget.copyFrom", { year: year - 1 })}>
                                <ActionIcon
                                  variant="subtle"
                                  aria-label={t("budget.copyFrom", { year: year - 1 })}
                                  onClick={() => copyFromPrevious(category)}
                                >
                                  ⎘
                                </ActionIcon>
                              </Tooltip>
                            )}
                            {canEdit && (planned || draft.existed) && (
                              <Tooltip label={t("budget.clear")}>
                                <ActionIcon
                                  variant="subtle"
                                  color="red"
                                  aria-label={t("budget.clear")}
                                  onClick={() =>
                                    setDrafts((m) =>
                                      new Map(m).set(category.id, blankDraft(category, profiles)),
                                    )
                                  }
                                >
                                  ✕
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </Group>
                        </Table.Td>
                      </Table.Tr>,
                      problem && (
                        <Table.Tr key={`${category.id}-problem`}>
                          <Table.Td colSpan={8} pt={0}>
                            <Text size="xs" c="red">
                              {t(problem)}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ),
                      isOpen && (
                        <Table.Tr key={`${category.id}-details`}>
                          <Table.Td colSpan={8}>
                            <Group align="flex-start" grow>
                              {draft.type === "periodic" && (
                                <Stack gap="xs">
                                  <Select
                                    size="xs"
                                    label={t("budget.account")}
                                    description={t("budget.accountHint")}
                                    disabled={!canEdit}
                                    clearable
                                    data={accountOptions}
                                    value={draft.accountId}
                                    onChange={(value) => update(category, { accountId: value })}
                                  />
                                  {needsRate && (
                                    <TextInput
                                      size="xs"
                                      label={t("budget.rate", {
                                        from: account.currency,
                                        to: bookCurrency,
                                      })}
                                      disabled={!canEdit}
                                      inputMode="decimal"
                                      value={draft.exchangeRate}
                                      error={problem === "budget.problemRate"}
                                      onChange={(e) =>
                                        update(category, { exchangeRate: e.currentTarget.value })
                                      }
                                    />
                                  )}
                                </Stack>
                              )}
                              <Textarea
                                size="xs"
                                label={t("budget.assumptions")}
                                disabled={!canEdit}
                                autosize
                                minRows={2}
                                maxLength={2000}
                                value={draft.assumptions}
                                onChange={(e) =>
                                  update(category, { assumptions: e.currentTarget.value })
                                }
                              />
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                      ),
                    ];
                  }),
                ];
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Paper withBorder p="sm">
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              <Table.Th ta="right">{t("budget.actualOf", { year: year - 1 })}</Table.Th>
              <Table.Th ta="right">{t("budget.planOf", { year })}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(["income", "expense", "saving"] as const).map((direction) => (
              <Table.Tr key={direction}>
                <Table.Td>{t(`directions.${direction}`)}</Table.Td>
                <Table.Td ta="right">{text(lastYear[direction])}</Table.Td>
                <Table.Td ta="right">{text(totals[direction])}</Table.Td>
              </Table.Tr>
            ))}
            <Table.Tr>
              <Table.Td fw={600}>
                <Tooltip label={t("budget.changeHint")}>
                  <span>{t("budget.change")}</span>
                </Tooltip>
              </Table.Td>
              <Table.Td ta="right" fw={600}>
                {text(change(lastYear))}
              </Table.Td>
              <Table.Td ta="right" fw={600}>
                {text(change(totals))}
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Paper>
      <StartFromPrevious
        opened={startOpen}
        year={year}
        onClose={() => setStartOpen(false)}
        onStart={(percent) => {
          startFromPrevious(percent);
          setStartOpen(false);
        }}
      />
    </Stack>
  );
}

function StartFromPrevious({
  opened,
  year,
  onClose,
  onStart,
}: {
  opened: boolean;
  year: number;
  onClose: () => void;
  onStart: (percent: number) => void;
}) {
  const { t } = useTranslation();
  const [percent, setPercent] = useState<number | string>(0);
  return (
    <Modal opened={opened} onClose={onClose} title={t("budget.startFrom", { year: year - 1 })}>
      <Stack>
        <Text size="sm">{t("budget.startHint", { year: year - 1 })}</Text>
        <NumberInput
          label={t("budget.increase")}
          suffix=" %"
          decimalScale={2}
          step={0.5}
          value={percent}
          onChange={setPercent}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onStart(Number(percent) || 0)}>{t("budget.fill")}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

const EVEN = [834, 834, 834, 834, 833, 833, 833, 833, 833, 833, 833, 833];
const MONTH_KEYS = Array.from({ length: 12 }, (_, i) => i);

function ProfilesPanel({
  bookId,
  defaultLanguage,
  profiles,
  canEdit,
}: {
  bookId: string;
  defaultLanguage: string;
  profiles: BudgetProfile[];
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const nameOf = useNameOf(defaultLanguage);
  const [editing, setEditing] = useState<BudgetProfile | "new" | null>(null);
  return (
    <Stack>
      {profiles.length === 0 && <Text c="dimmed">{t("budget.noProfile")}</Text>}
      {profiles.map((profile) => (
        <Group key={profile.id} justify="space-between">
          <Group gap="xs">
            <Text>{nameOf(profile.names)}</Text>
            {profile.archived && <Badge color="gray">{t("reference.archived")}</Badge>}
          </Group>
          <Button variant="subtle" size="xs" onClick={() => setEditing(profile)}>
            {canEdit ? t("budget.edit") : t("budget.view")}
          </Button>
        </Group>
      ))}
      {canEdit && editing === null && (
        <Group>
          <Button onClick={() => setEditing("new")}>{t("budget.newProfile")}</Button>
        </Group>
      )}
      {editing !== null && (
        <ProfileForm
          key={editing === "new" ? "new" : editing.id}
          bookId={bookId}
          defaultLanguage={defaultLanguage}
          profile={editing === "new" ? undefined : editing}
          canEdit={canEdit}
          onDone={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}

function ProfileForm({
  bookId,
  defaultLanguage,
  profile,
  canEdit,
  onDone,
}: {
  bookId: string;
  defaultLanguage: string;
  profile?: BudgetProfile;
  canEdit: boolean;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(profile?.names[defaultLanguage] ?? "");
  const [weights, setWeights] = useState<number[]>(profile?.weights ?? EVEN);
  const total = weights.reduce((a, b) => a + b, 0);
  const valid = total === 10_000 && name.trim() !== "";
  const months = new Intl.DateTimeFormat(i18n.language, { month: "short" });

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ["books", bookId, "budgets"] });
    onDone();
  };
  const save = useMutation({
    mutationFn: () => {
      const names = { ...profile?.names, [defaultLanguage]: name.trim() };
      return profile
        ? unwrap(
            api.books[":bookId"].budgets.profiles[":id"].$patch({
              param: { bookId, id: profile.id },
              json: { names, weights, version: profile.version },
            }),
          )
        : unwrap(
            api.books[":bookId"].budgets.profiles.$post({
              param: { bookId },
              json: { names, weights },
            }),
          );
    },
    onSuccess: done,
  });
  const archive = useMutation({
    mutationFn: () =>
      unwrap(
        api.books[":bookId"].budgets.profiles[":id"].$patch({
          param: { bookId, id: profile!.id },
          json: { archived: !profile!.archived, version: profile!.version },
        }),
      ),
    onSuccess: done,
  });
  const error = save.error ?? archive.error;

  return (
    <Paper withBorder p="sm">
      <Stack>
        {error && <Alert color="red">{t("common.error", { message: error.message })}</Alert>}
        <TextInput
          label={t("budget.profileName")}
          required
          maxLength={100}
          disabled={!canEdit}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Group grow>
          {MONTH_KEYS.map((month) => (
            <NumberInput
              key={month}
              size="xs"
              label={months.format(new Date(2026, month, 1))}
              suffix=" %"
              decimalScale={2}
              step={0.5}
              min={0}
              max={100}
              disabled={!canEdit}
              value={(weights[month] ?? 0) / 100}
              onChange={(value) =>
                setWeights(
                  weights.map((w, i) => (i === month ? Math.round(Number(value) * 100) : w)),
                )
              }
              style={{ minWidth: 70 }}
            />
          ))}
        </Group>
        <Text size="sm" c={total === 10_000 ? "dimmed" : "red"}>
          {t("budget.total", { total: (total / 100).toFixed(2) })}
        </Text>
        <Group justify="space-between">
          <Group>
            {canEdit && (
              <Button variant="default" size="xs" onClick={() => setWeights(EVEN)}>
                {t("budget.even")}
              </Button>
            )}
            {canEdit && profile && (
              <Button
                variant="default"
                size="xs"
                loading={archive.isPending}
                onClick={() => archive.mutate()}
              >
                {profile.archived ? t("budget.unarchive") : t("budget.archive")}
              </Button>
            )}
          </Group>
          <Group>
            <Button variant="default" onClick={onDone}>
              {t("common.cancel")}
            </Button>
            {canEdit && (
              <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
                {t("common.save")}
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Paper>
  );
}
