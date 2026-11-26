import {
  accountKinds,
  formatMoney,
  groupColors,
  parseAmount,
  type AccountKind,
  type GroupColor,
  type Names,
} from "@cash-scout/domain";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  ColorSwatch,
  Group,
  Menu,
  Modal,
  MultiSelect,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { currencyOptions } from "../options";
import { useBalances } from "../journal";
import {
  useNameOf,
  useReference,
  useReferenceChange,
  useSetOpening,
  type Reference,
  type ReferenceKind,
} from "../reference";
import { DataTable } from "../table";

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** The palette a group's colour is taken from, with "none" to inherit the parent's. */
function ColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (color: GroupColor | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>
        {t("reference.color")}
      </Text>
      <Group gap={6}>
        <Button
          size="compact-xs"
          variant={value === null ? "filled" : "default"}
          onClick={() => onChange(null)}
        >
          {t("reference.noColor")}
        </Button>
        {groupColors.map((color) => (
          <ColorSwatch
            key={color}
            component="button"
            type="button"
            color={`var(--mantine-color-${color}-6)`}
            size={22}
            aria-label={color}
            aria-pressed={value === color}
            onClick={() => onChange(color)}
            style={{ cursor: "pointer", color: "white" }}
          >
            {value === color ? "✓" : null}
          </ColorSwatch>
        ))}
      </Group>
      <Text size="xs" c="dimmed">
        {t("reference.colorHint")}
      </Text>
    </Stack>
  );
}

/** One name field per book language; the default language is required. */
function NamesFields({
  languages,
  value,
  onChange,
}: {
  languages: string[];
  value: Names;
  onChange: (names: Names) => void;
}) {
  const { t, i18n } = useTranslation();
  const languageNames = new Intl.DisplayNames([i18n.language], { type: "language" });
  return (
    <>
      {languages.map((language, index) => (
        <TextInput
          key={language}
          label={`${t("reference.name")} – ${languageNames.of(language)}`}
          required={index === 0}
          maxLength={100}
          value={value[language] ?? ""}
          onChange={(e) => onChange({ ...value, [language]: e.currentTarget.value })}
          data-autofocus={index === 0 ? true : undefined}
        />
      ))}
    </>
  );
}

/** Names without empty values, as the API expects. */
function cleanNames(names: Names): Names {
  return Object.fromEntries(
    Object.entries(names)
      .map(([language, name]) => [language, name.trim()])
      .filter(([, name]) => name !== ""),
  );
}

interface EditorState {
  title: string;
  kind: ReferenceKind;
  id?: string;
  /** Revision of the item as read; the API refuses the change if the item moved on. */
  version?: number;
  names: Names;
  /** Other fields of the item, edited by `extra`. */
  fields: Record<string, unknown>;
  extra?: (fields: Record<string, unknown>, set: (f: Record<string, unknown>) => void) => ReactNode;
  /** Builds the request body from the names and fields. */
  body: (names: Names, fields: Record<string, unknown>) => unknown;
}

function Editor({
  bookId,
  languages,
  state,
  onClose,
}: {
  bookId: string;
  languages: string[];
  state: EditorState;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const change = useReferenceChange(bookId);
  const [names, setNames] = useState(state.names);
  const [fields, setFields] = useState(state.fields);

  function submit(event: FormEvent) {
    event.preventDefault();
    change.mutate(
      {
        kind: state.kind,
        id: state.id,
        method: state.id ? "PATCH" : "POST",
        body: {
          ...(state.body(cleanNames(names), fields) as object),
          ...(state.id && { version: state.version }),
        },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Stack component="form" onSubmit={submit}>
      {change.error && (
        <Alert color="red">{t("common.error", { message: change.error.message })}</Alert>
      )}
      <NamesFields languages={languages} value={names} onChange={setNames} />
      {state.extra?.(fields, (f) => setFields({ ...fields, ...f }))}
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={change.isPending}>
          {state.id ? t("common.save") : t("common.create")}
        </Button>
      </Group>
    </Stack>
  );
}

/** Menu of actions on an item: edit, archive or restore, delete. */
function ItemMenu({
  bookId,
  kind,
  id,
  version,
  archived,
  canEdit,
  onEdit,
  children,
}: {
  bookId: string;
  kind: ReferenceKind;
  id: string;
  version: number;
  archived: boolean;
  canEdit: boolean;
  onEdit: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const change = useReferenceChange(bookId);
  if (!canEdit) return null;
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" aria-label={t("reference.actions")}>
          ⋯
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        {children}
        <Menu.Item onClick={onEdit}>{t("reference.edit")}</Menu.Item>
        <Menu.Item
          onClick={() =>
            change.mutate({ kind, id, method: "PATCH", body: { archived: !archived, version } })
          }
        >
          {archived ? t("reference.restore") : t("reference.archive")}
        </Menu.Item>
        <Menu.Item
          color="red"
          onClick={() =>
            change.mutate(
              { kind, id, method: "DELETE" },
              { onError: (error) => window.alert(error.message) },
            )
          }
        >
          {t("common.delete")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function ArchivedBadge({ archived }: { archived: boolean }) {
  const { t } = useTranslation();
  return archived ? (
    <Badge size="xs" color="gray" variant="outline">
      {t("reference.archived")}
    </Badge>
  ) : null;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

function CategoriesTab({ bookId, reference, canEdit, showArchived, openEditor }: TabProps) {
  const { t } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const visible = <T extends { archived: boolean }>(items: T[]) =>
    showArchived ? items : items.filter((item) => !item.archived);
  /** Groups the user has folded; everything starts open. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggleFold = (id: string) =>
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const groupOptions = reference.groups.map((g) => ({ value: g.id, label: nameOf(g.names) }));
  const categoryOptions = reference.categories.map((c) => ({
    value: c.id,
    label: `${c.code} ${nameOf(c.names)}`,
  }));
  const natureName = (id: string) => {
    const found = reference.natures.find((n) => n.id === id);
    return found ? nameOf(found.names) : "";
  };

  /** "Patrimoine › Rennes": a group's name with those of the groups around it. */
  const groupPath = (id: string): string => {
    const names: string[] = [];
    for (
      let at = reference.groups.find((g) => g.id === id);
      at && names.length < 20;
      at = at.parentId === null ? undefined : reference.groups.find((g) => g.id === at!.parentId)
    ) {
      names.unshift(nameOf(at.names));
    }
    return names.join(" › ");
  };

  /** The ids of a group's descendants, which cannot become its parent. */
  const descendantsOf = (id: string): Set<string> => {
    const found = new Set<string>();
    for (let added = true; added;) {
      added = false;
      for (const g of reference.groups) {
        if (
          !found.has(g.id) &&
          g.parentId !== null &&
          (g.parentId === id || found.has(g.parentId))
        ) {
          found.add(g.id);
          added = true;
        }
      }
    }
    return found;
  };

  const groupEditor = (
    group?: Reference["groups"][number],
    parentId: string | null = null,
  ): EditorState => ({
    title: group ? t("reference.editGroup") : t("reference.newGroup"),
    kind: "groups",
    id: group?.id,
    version: group?.version,
    names: group?.names ?? {},
    fields: {
      position: reference.groups.filter((g) => g.parentId === parentId).length,
      parentId: group ? group.parentId : parentId,
      color: group?.color ?? null,
    },
    extra: (fields, set) => {
      const excluded = group ? new Set([group.id, ...descendantsOf(group.id)]) : new Set<string>();
      return (
        <>
          <Select
            label={t("reference.parentGroup")}
            description={t("reference.parentGroupHint")}
            clearable
            searchable
            data={reference.groups
              .filter((g) => !excluded.has(g.id) && (!g.archived || g.id === fields.parentId))
              .map((g) => ({ value: g.id, label: groupPath(g.id) }))}
            value={(fields.parentId as string | null) ?? null}
            onChange={(value) => set({ parentId: value })}
          />
          <ColorPicker
            value={(fields.color as string | null) ?? null}
            onChange={(color) => set({ color })}
          />
        </>
      );
    },
    // An existing group keeps its place among its siblings; the arrows move it.
    body: (names, fields) => ({
      names,
      ...(group ? {} : { position: fields.position }),
      parentId: (fields.parentId as string | null) ?? null,
      color: (fields.color as string | null) ?? null,
    }),
  });

  const categoryEditor = (
    groupId: string,
    item?: Reference["categories"][number],
  ): EditorState => ({
    title: item ? t("reference.editCategory") : t("reference.newCategory"),
    kind: "categories",
    id: item?.id,
    version: item?.version,
    names: item?.names ?? {},
    fields: {
      groupId: item?.groupId ?? groupId,
      code: item?.code ?? "",
      natureId:
        item?.natureId ??
        reference.natures.find((n) => !n.transfer && !n.archived)?.id ??
        reference.natures[0]?.id ??
        null,
    },
    extra: (fields, set) => (
      <>
        <TextInput
          label={t("reference.code")}
          description={t("reference.codeHint")}
          required
          maxLength={10}
          value={fields.code as string}
          onChange={(e) => set({ code: e.currentTarget.value })}
        />
        <Select
          label={t("reference.nature")}
          required
          data={reference.natures
            .filter((n) => !n.archived || n.id === fields.natureId)
            .map((n) => ({ value: n.id, label: nameOf(n.names) }))}
          allowDeselect={false}
          value={(fields.natureId as string | null) ?? null}
          onChange={(value) => value && set({ natureId: value })}
        />
        <Select
          label={t("reference.group")}
          data={groupOptions}
          allowDeselect={false}
          value={fields.groupId as string}
          onChange={(value) => value && set({ groupId: value })}
        />
      </>
    ),
    body: (names, fields) => ({ names, ...fields }),
  });

  const subCategoryEditor = (
    categoryId: string,
    item?: Reference["subCategories"][number],
  ): EditorState => ({
    title: item ? t("reference.editSubCategory") : t("reference.newSubCategory"),
    kind: "sub-categories",
    id: item?.id,
    version: item?.version,
    names: item?.names ?? {},
    fields: { categoryId: item?.categoryId ?? categoryId },
    extra: (fields, set) => (
      <Select
        label={t("reference.category")}
        description={item ? t("reference.moveHint") : undefined}
        data={categoryOptions}
        searchable
        allowDeselect={false}
        value={fields.categoryId as string}
        onChange={(value) => value && set({ categoryId: value })}
      />
    ),
    body: (names, fields) => ({ names, categoryId: fields.categoryId }),
  });

  const groups = visible(reference.groups);
  const change = useReferenceChange(bookId);
  /** The groups directly under a parent, in their order. */
  const siblings = (parentId: string | null) =>
    groups
      .filter(
        (g) =>
          (g.parentId !== null && groups.some((p) => p.id === g.parentId) ? g.parentId : null) ===
          parentId,
      )
      .sort((a, b) => a.position - b.position || nameOf(a.names).localeCompare(nameOf(b.names)));
  /** Swaps a group with its neighbour: the whole row of siblings is renumbered at once. */
  const move = (group: Reference["groups"][number], by: -1 | 1) => {
    const row = siblings(group.parentId);
    const at = row.findIndex((g) => g.id === group.id);
    const to = at + by;
    if (to < 0 || to >= row.length) return;
    const ids = row.map((g) => g.id);
    [ids[at], ids[to]] = [ids[to]!, ids[at]!];
    change.mutate({ kind: "groups", id: "reorder", method: "POST", body: { ids } });
  };

  const renderGroup = (group: Reference["groups"][number], depth: number) => {
    const row = siblings(group.parentId);
    const at = row.findIndex((g) => g.id === group.id);
    const categories = visible(reference.categories.filter((c) => c.groupId === group.id));
    const children = siblings(group.id);
    const isFolded = folded.has(group.id);
    return (
      <Paper
        key={group.id}
        withBorder
        p="sm"
        style={
          group.color
            ? { borderLeft: `4px solid var(--mantine-color-${group.color}-6)` }
            : undefined
        }
      >
        <Group justify="space-between" mb={isFolded ? 0 : "xs"}>
          <Group gap="xs">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-expanded={!isFolded}
              aria-label={isFolded ? t("reference.expand") : t("reference.collapse")}
              onClick={() => toggleFold(group.id)}
            >
              {isFolded ? "▸" : "▾"}
            </ActionIcon>
            {canEdit && (
              <Group gap={0}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={t("reference.moveUp")}
                  disabled={at <= 0 || change.isPending}
                  onClick={() => move(group, -1)}
                >
                  ↑
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={t("reference.moveDown")}
                  disabled={at < 0 || at >= row.length - 1 || change.isPending}
                  onClick={() => move(group, 1)}
                >
                  ↓
                </ActionIcon>
              </Group>
            )}
            <Title order={depth === 0 ? 4 : 5}>{nameOf(group.names)}</Title>
            <ArchivedBadge archived={group.archived} />
            {isFolded && (
              <Text size="sm" c="dimmed">
                {t("reference.foldedCount", { count: categories.length })}
              </Text>
            )}
          </Group>
          <ItemMenu
            bookId={bookId}
            kind="groups"
            id={group.id}
            version={group.version}
            archived={group.archived}
            canEdit={canEdit}
            onEdit={() => openEditor(groupEditor(group))}
          >
            <Menu.Item onClick={() => openEditor(categoryEditor(group.id))}>
              {t("reference.newCategory")}
            </Menu.Item>
            <Menu.Item onClick={() => openEditor(groupEditor(undefined, group.id))}>
              {t("reference.newSubGroup")}
            </Menu.Item>
          </ItemMenu>
        </Group>
        {!isFolded && (
          <Table>
            <Table.Tbody>
              {categories.map((item) => {
                const subCategories = visible(
                  reference.subCategories.filter((s) => s.categoryId === item.id),
                ).sort((a, b) => nameOf(a.names).localeCompare(nameOf(b.names)));
                return (
                  <Table.Tr key={item.id}>
                    <Table.Td w={80} valign="top">
                      <Badge variant="light">{item.code}</Badge>
                    </Table.Td>
                    <Table.Td valign="top">
                      <Group gap="xs">
                        <Text fw={500}>{nameOf(item.names)}</Text>
                        <Badge size="xs" variant="dot">
                          {natureName(item.natureId)}
                        </Badge>
                        <ArchivedBadge archived={item.archived} />
                      </Group>
                      <Stack gap={2} mt={4} pl="md">
                        {subCategories.map((sub) => (
                          <Group key={sub.id} gap="xs" wrap="nowrap">
                            <Text size="sm">{nameOf(sub.names)}</Text>
                            <ArchivedBadge archived={sub.archived} />
                            <ItemMenu
                              bookId={bookId}
                              kind="sub-categories"
                              id={sub.id}
                              version={sub.version}
                              archived={sub.archived}
                              canEdit={canEdit}
                              onEdit={() => openEditor(subCategoryEditor(item.id, sub))}
                            />
                          </Group>
                        ))}
                      </Stack>
                    </Table.Td>
                    <Table.Td w={50} valign="top">
                      <ItemMenu
                        bookId={bookId}
                        kind="categories"
                        id={item.id}
                        version={item.version}
                        archived={item.archived}
                        canEdit={canEdit}
                        onEdit={() => openEditor(categoryEditor(group.id, item))}
                      >
                        <Menu.Item onClick={() => openEditor(subCategoryEditor(item.id))}>
                          {t("reference.newSubCategory")}
                        </Menu.Item>
                      </ItemMenu>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
        {!isFolded && children.length > 0 && (
          <Stack mt="sm" ml="md">
            {children.map((child) => renderGroup(child, depth + 1))}
          </Stack>
        )}
      </Paper>
    );
  };

  return (
    <Stack>
      <Group>
        {canEdit && (
          <Button onClick={() => openEditor(groupEditor())}>{t("reference.newGroup")}</Button>
        )}
        <Button variant="default" onClick={() => setFolded(new Set())}>
          {t("reference.expandAll")}
        </Button>
        <Button variant="default" onClick={() => setFolded(new Set(groups.map((g) => g.id)))}>
          {t("reference.collapseAll")}
        </Button>
      </Group>
      {groups.length === 0 && <Text c="dimmed">{t("reference.emptyCategories")}</Text>}
      {siblings(null).map((group) => renderGroup(group, 0))}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Accounts and payment types
// ---------------------------------------------------------------------------

/**
 * Sets an account's opening balance: from the balance read in the online bank
 * (the usual way), or straight to an amount. The result is shown before saving.
 */
function OpeningForm({
  bookId,
  bookCurrency,
  account,
  onClose,
}: {
  bookId: string;
  bookCurrency: string;
  account: Reference["accounts"][number];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const set = useSetOpening(bookId);
  const balances = useBalances(bookId);
  const [mode, setMode] = useState<"balance" | "opening">("balance");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const needsRate = account.currency !== bookCurrency;
  const text = amount.trim().replace(",", ".");
  const parsed = (() => {
    try {
      return text === "" ? null : parseAmount(text, account.currency).minor;
    } catch {
      return null;
    }
  })();
  const current = parseAmount(account.openingBalance, account.currency).minor;
  const reconciled = balances.data?.find((b) => b.accountId === account.id)?.reconciled;
  // The reconciled balance holds the opening balance: take it out to get what the entries add up to.
  const entries =
    reconciled === undefined ? null : parseAmount(reconciled, account.currency).minor - current;
  const result =
    parsed === null
      ? null
      : mode === "opening"
        ? parsed
        : entries === null
          ? null
          : parsed - entries;
  const show = (minor: bigint) => formatMoney({ minor, currency: account.currency }, i18n.language);

  function submit(event: FormEvent) {
    event.preventDefault();
    set.mutate(
      {
        accountId: account.id,
        body: mode === "balance" ? { balance: text } : { opening: text },
        exchangeRate: needsRate ? rate.trim().replace(",", ".") : undefined,
        version: account.version,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Stack component="form" onSubmit={submit}>
      {set.error && <Alert color="red">{t("common.error", { message: set.error.message })}</Alert>}
      <Text size="sm" c="dimmed">
        {t("reference.openingIntro")}
      </Text>
      <SegmentedControl
        value={mode}
        onChange={(value) => setMode(value as "balance" | "opening")}
        data={[
          { value: "balance", label: t("reference.openingFromBalance") },
          { value: "opening", label: t("reference.openingAmount") },
        ]}
      />
      <TextInput
        label={mode === "balance" ? t("reference.bankBalance") : t("reference.openingBalance")}
        description={
          mode === "balance" ? t("reference.bankBalanceHint") : t("reference.openingAmountHint")
        }
        required
        data-autofocus
        value={amount}
        onChange={(e) => setAmount(e.currentTarget.value)}
        rightSection={<Text size="xs">{account.currency}</Text>}
        rightSectionWidth={44}
      />
      {needsRate && (
        <TextInput
          label={t("journal.exchangeRate")}
          description={t("reference.openingRateHint", { from: account.currency, to: bookCurrency })}
          value={rate}
          onChange={(e) => setRate(e.currentTarget.value)}
        />
      )}
      <Text size="sm">
        {t("reference.openingNow", { amount: show(current) })}
        {result !== null && (
          <>
            <br />
            <b>{t("reference.openingAfter", { amount: show(result) })}</b>{" "}
            {result !== current && `(${show(result - current)})`}
          </>
        )}
      </Text>
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={set.isPending} disabled={parsed === null}>
          {t("common.save")}
        </Button>
      </Group>
    </Stack>
  );
}

function AccountsTab({
  bookId,
  bookCurrency,
  reference,
  canEdit,
  showArchived,
  openEditor,
}: TabProps) {
  const { t, i18n } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const [openingOf, setOpeningOf] = useState<Reference["accounts"][number] | null>(null);
  const accounts = reference.accounts
    .filter((a) => showArchived || !a.archived)
    .sort((a, b) => nameOf(a.names).localeCompare(nameOf(b.names)));

  const editor = (item?: Reference["accounts"][number]): EditorState => ({
    title: item ? t("reference.editAccount") : t("reference.newAccount"),
    kind: "accounts",
    id: item?.id,
    version: item?.version,
    names: item?.names ?? {},
    fields: {
      kind: item?.kind ?? "bank",
      currency: item?.currency ?? "EUR",
      lowBalanceThreshold: item?.lowBalanceThreshold ?? "",
    },
    extra: (fields, set) => (
      <>
        <SegmentedControl
          disabled={!!item}
          data={accountKinds.map((k) => ({ value: k, label: t(`accountKinds.${k}`) }))}
          value={fields.kind as string}
          onChange={(value) => set({ kind: value as AccountKind })}
        />
        <Text size="xs" c="dimmed">
          {t(`accountKinds.${fields.kind as AccountKind}Hint`)}
        </Text>
        <Select
          label={t("books.currency")}
          description={t("reference.currencyHint")}
          disabled={!!item}
          searchable
          data={currencyOptions(i18n.language)}
          allowDeselect={false}
          value={fields.currency as string}
          onChange={(value) => value && set({ currency: value })}
        />
        {fields.kind === "bank" && (
          <TextInput
            label={t("reference.threshold")}
            description={t("reference.thresholdHint")}
            placeholder="-500"
            value={fields.lowBalanceThreshold as string}
            onChange={(e) => set({ lowBalanceThreshold: e.currentTarget.value })}
          />
        )}
      </>
    ),
    body: (names, fields) => {
      const lowBalanceThreshold =
        fields.kind === "bank" && fields.lowBalanceThreshold !== ""
          ? String(fields.lowBalanceThreshold).replace(",", ".")
          : null;
      return item
        ? { names, lowBalanceThreshold }
        : { names, kind: fields.kind, currency: fields.currency, lowBalanceThreshold };
    },
  });

  return (
    <Stack>
      {canEdit && (
        <Group>
          <Button onClick={() => openEditor(editor())}>{t("reference.newAccount")}</Button>
        </Group>
      )}
      {accounts.length === 0 && <Text c="dimmed">{t("reference.emptyAccounts")}</Text>}
      {accounts.length > 0 && (
        <DataTable minWidth={700}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("reference.name")}</Table.Th>
              <Table.Th>{t("reference.kind")}</Table.Th>
              <Table.Th>{t("books.currency")}</Table.Th>
              <Table.Th>{t("reference.threshold")}</Table.Th>
              <Table.Th>{t("reference.openingBalance")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {accounts.map((item) => (
              <Table.Tr key={item.id}>
                <Table.Td>
                  <Group gap="xs">
                    {nameOf(item.names)}
                    <ArchivedBadge archived={item.archived} />
                  </Group>
                </Table.Td>
                <Table.Td>{t(`accountKinds.${item.kind}`)}</Table.Td>
                <Table.Td>{item.currency}</Table.Td>
                <Table.Td>
                  {item.lowBalanceThreshold === null
                    ? ""
                    : formatMoney(
                        parseAmount(item.lowBalanceThreshold, item.currency),
                        i18n.language,
                      )}
                </Table.Td>
                <Table.Td>
                  {item.kind === "bank" &&
                    formatMoney(parseAmount(item.openingBalance, item.currency), i18n.language)}
                </Table.Td>
                <Table.Td w={50}>
                  <ItemMenu
                    bookId={bookId}
                    kind="accounts"
                    id={item.id}
                    version={item.version}
                    archived={item.archived}
                    canEdit={canEdit}
                    onEdit={() => openEditor(editor(item))}
                  >
                    {item.kind === "bank" && (
                      <Menu.Item onClick={() => setOpeningOf(item)}>
                        {t("reference.setOpening")}
                      </Menu.Item>
                    )}
                  </ItemMenu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </DataTable>
      )}
      <Modal
        opened={openingOf !== null}
        onClose={() => setOpeningOf(null)}
        title={t("reference.setOpeningTitle", { name: openingOf ? nameOf(openingOf.names) : "" })}
      >
        {openingOf && (
          <OpeningForm
            bookId={bookId}
            bookCurrency={bookCurrency}
            account={openingOf}
            onClose={() => setOpeningOf(null)}
          />
        )}
      </Modal>
    </Stack>
  );
}

function PaymentTypesTab({ bookId, reference, canEdit, showArchived, openEditor }: TabProps) {
  const { t } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const items = reference.paymentTypes
    .filter((p) => showArchived || !p.archived)
    .sort((a, b) => nameOf(a.names).localeCompare(nameOf(b.names)));

  const editor = (item?: Reference["paymentTypes"][number]): EditorState => ({
    title: item ? t("reference.editPaymentType") : t("reference.newPaymentType"),
    kind: "payment-types",
    id: item?.id,
    version: item?.version,
    names: item?.names ?? {},
    fields: {},
    body: (names) => ({ names }),
  });

  return (
    <Stack>
      {canEdit && (
        <Group>
          <Button onClick={() => openEditor(editor())}>{t("reference.newPaymentType")}</Button>
        </Group>
      )}
      {items.length === 0 && <Text c="dimmed">{t("reference.emptyPaymentTypes")}</Text>}
      <Table>
        <Table.Tbody>
          {items.map((item) => (
            <Table.Tr key={item.id}>
              <Table.Td>
                <Group gap="xs">
                  {nameOf(item.names)}
                  <ArchivedBadge archived={item.archived} />
                </Group>
              </Table.Td>
              <Table.Td w={50}>
                <ItemMenu
                  bookId={bookId}
                  kind="payment-types"
                  id={item.id}
                  version={item.version}
                  archived={item.archived}
                  canEdit={canEdit}
                  onEdit={() => openEditor(editor(item))}
                />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Natures and balances: one list, in the order the dashboard shows it
// ---------------------------------------------------------------------------

function NaturesTab({ bookId, reference, canEdit, showArchived, openEditor }: TabProps) {
  const { t } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const change = useReferenceChange(bookId);

  const lines = [
    ...reference.natures.map((n) => ({ kind: "nature" as const, item: n })),
    ...reference.balances.map((b) => ({ kind: "balance" as const, item: b })),
  ]
    .filter(({ item }) => showArchived || !item.archived)
    .sort((a, b) => a.item.position - b.item.position);
  const natureName = (id: string) => {
    const found = reference.natures.find((n) => n.id === id);
    return found ? nameOf(found.names) : "";
  };
  const placeOf = (kind: "nature" | "balance", id: string) =>
    reference.natures.some((n) => kind === "nature" && n.id === id)
      ? reference.natures.find((n) => n.id === id)!.position
      : (reference.balances.find((b) => b.id === id)?.position ?? 0);

  /** Swaps a line with its neighbour: the whole list is renumbered at once. */
  const move = (at: number, by: -1 | 1) => {
    const to = at + by;
    if (to < 0 || to >= lines.length) return;
    const items = lines.map(({ kind, item }) => ({ kind, id: item.id }));
    [items[at], items[to]] = [items[to]!, items[at]!];
    change.mutate({ kind: "lines", id: "reorder", method: "POST", body: { items } });
  };

  const natureEditor = (item?: Reference["natures"][number]): EditorState => ({
    title: item ? t("reference.editNature") : t("reference.newNature"),
    kind: "natures",
    id: item?.id,
    version: item?.version,
    names: item?.names ?? {},
    fields: { sign: item?.sign ?? -1, transfer: item?.transfer ?? false },
    extra: (fields, set) => (
      <>
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            {t("reference.sign")}
          </Text>
          <SegmentedControl
            data={[
              { value: "1", label: t("reference.signAsEntered") },
              { value: "-1", label: t("reference.signReversed") },
            ]}
            value={String(fields.sign)}
            onChange={(value) => set({ sign: Number(value) })}
          />
        </Stack>
        <Switch
          label={t("reference.transfer")}
          description={t("reference.transferHint")}
          checked={fields.transfer === true}
          onChange={(event) => set({ transfer: event.currentTarget.checked })}
        />
      </>
    ),
    body: (names, fields) => ({ names, sign: fields.sign, transfer: fields.transfer }),
  });

  const balanceEditor = (item?: Reference["balances"][number]): EditorState => ({
    title: item ? t("reference.editBalance") : t("reference.newBalance"),
    kind: "balances",
    id: item?.id,
    version: item?.version,
    names: item?.names ?? {},
    fields: { natureIds: item?.natureIds ?? [] },
    extra: (fields, set) => (
      <MultiSelect
        label={t("reference.balanceNatures")}
        description={t("reference.balanceNaturesHint")}
        required
        data={reference.natures
          .filter((n) => !n.archived || (fields.natureIds as string[]).includes(n.id))
          .map((n) => ({ value: n.id, label: nameOf(n.names) }))}
        value={fields.natureIds as string[]}
        onChange={(natureIds) => set({ natureIds })}
      />
    ),
    body: (names, fields) => ({ names, natureIds: fields.natureIds }),
  });

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {t("reference.naturesIntro")}
      </Text>
      {canEdit && (
        <Group>
          <Button onClick={() => openEditor(natureEditor())}>{t("reference.newNature")}</Button>
          <Button variant="default" onClick={() => openEditor(balanceEditor())}>
            {t("reference.newBalance")}
          </Button>
        </Group>
      )}
      <Table>
        <Table.Tbody>
          {lines.map(({ kind, item }, at) => {
            // A balance listed above one of its natures still adds it up: only a hint.
            const early =
              kind === "balance" &&
              (item as Reference["balances"][number]).natureIds.some(
                (id) => placeOf("nature", id) > item.position,
              );
            return (
              <Table.Tr key={`${kind}:${item.id}`}>
                {canEdit && (
                  <Table.Td w={70}>
                    <Group gap={0} wrap="nowrap">
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        aria-label={t("reference.moveUp")}
                        disabled={at === 0 || change.isPending}
                        onClick={() => move(at, -1)}
                      >
                        ↑
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        aria-label={t("reference.moveDown")}
                        disabled={at === lines.length - 1 || change.isPending}
                        onClick={() => move(at, 1)}
                      >
                        ↓
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                )}
                <Table.Td>
                  <Group gap="xs">
                    <Text fw={kind === "balance" ? 700 : 500}>{nameOf(item.names)}</Text>
                    {kind === "nature" ? (
                      <>
                        {(item as Reference["natures"][number]).transfer && (
                          <Badge size="xs" variant="dot">
                            {t("reference.transferBadge")}
                          </Badge>
                        )}
                        <Badge size="xs" variant="light" color="gray">
                          {(item as Reference["natures"][number]).sign === -1
                            ? t("reference.signReversed")
                            : t("reference.signAsEntered")}
                        </Badge>
                      </>
                    ) : (
                      <>
                        <Badge size="xs" variant="light" color="grape">
                          {t("reference.balance")}
                        </Badge>
                        <Text size="sm" c="dimmed">
                          {(item as Reference["balances"][number]).natureIds
                            .map(natureName)
                            .join(" + ")}
                        </Text>
                        {early && (
                          <Badge size="xs" variant="outline" color="yellow">
                            {t("reference.balanceAbove")}
                          </Badge>
                        )}
                      </>
                    )}
                    <ArchivedBadge archived={item.archived} />
                  </Group>
                </Table.Td>
                <Table.Td w={50}>
                  <ItemMenu
                    bookId={bookId}
                    kind={kind === "nature" ? "natures" : "balances"}
                    id={item.id}
                    version={item.version}
                    archived={item.archived}
                    canEdit={canEdit}
                    onEdit={() =>
                      openEditor(
                        kind === "nature"
                          ? natureEditor(item as Reference["natures"][number])
                          : balanceEditor(item as Reference["balances"][number]),
                      )
                    }
                  />
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface TabProps {
  bookId: string;
  bookCurrency: string;
  reference: Reference;
  canEdit: boolean;
  showArchived: boolean;
  openEditor: (state: EditorState) => void;
}

export function ReferenceData({
  bookId,
  bookCurrency,
  canEdit,
}: {
  bookId: string;
  bookCurrency: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const reference = useReference(bookId);
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);

  if (reference.error) {
    return <Alert color="red">{t("common.error", { message: reference.error.message })}</Alert>;
  }
  if (!reference.data) return null;

  const props: TabProps = {
    bookId,
    bookCurrency,
    reference: reference.data,
    canEdit,
    showArchived,
    openEditor: setEditor,
  };

  return (
    <Stack>
      <Tabs defaultValue="categories" keepMounted={false}>
        <Group justify="space-between">
          <Tabs.List>
            <Tabs.Tab value="categories">{t("reference.categories")}</Tabs.Tab>
            <Tabs.Tab value="natures">{t("reference.natures")}</Tabs.Tab>
            <Tabs.Tab value="accounts">{t("reference.accounts")}</Tabs.Tab>
            <Tabs.Tab value="paymentTypes">{t("reference.paymentTypes")}</Tabs.Tab>
          </Tabs.List>
          <Switch
            label={t("reference.showArchived")}
            checked={showArchived}
            onChange={(e) => setShowArchived(e.currentTarget.checked)}
          />
        </Group>
        <Tabs.Panel value="categories" pt="md">
          <CategoriesTab {...props} />
        </Tabs.Panel>
        <Tabs.Panel value="natures" pt="md">
          <NaturesTab {...props} />
        </Tabs.Panel>
        <Tabs.Panel value="accounts" pt="md">
          <AccountsTab {...props} />
        </Tabs.Panel>
        <Tabs.Panel value="paymentTypes" pt="md">
          <PaymentTypesTab {...props} />
        </Tabs.Panel>
      </Tabs>
      <Modal opened={editor !== null} onClose={() => setEditor(null)} title={editor?.title}>
        {editor && (
          <Editor
            bookId={bookId}
            languages={reference.data.languages}
            state={editor}
            onClose={() => setEditor(null)}
          />
        )}
      </Modal>
    </Stack>
  );
}
