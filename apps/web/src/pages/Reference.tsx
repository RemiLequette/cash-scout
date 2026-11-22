import {
  accountKinds,
  directions,
  formatMoney,
  parseAmount,
  type AccountKind,
  type Direction,
  type Names,
} from "@cash-scout/domain";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  NumberInput,
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
import {
  useNameOf,
  useReference,
  useReferenceChange,
  type Reference,
  type ReferenceKind,
} from "../reference";

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

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
        body: state.body(cleanNames(names), fields),
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
  archived,
  canEdit,
  onEdit,
  children,
}: {
  bookId: string;
  kind: ReferenceKind;
  id: string;
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
            change.mutate({ kind, id, method: "PATCH", body: { archived: !archived } })
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

  const groupOptions = reference.groups.map((g) => ({ value: g.id, label: nameOf(g.names) }));
  const categoryOptions = reference.categories.map((c) => ({
    value: c.id,
    label: `${c.code} ${nameOf(c.names)}`,
  }));
  const directionOptions = directions.map((d) => ({ value: d, label: t(`directions.${d}`) }));

  const groupEditor = (group?: Reference["groups"][number]): EditorState => ({
    title: group ? t("reference.editGroup") : t("reference.newGroup"),
    kind: "groups",
    id: group?.id,
    names: group?.names ?? {},
    fields: { position: group?.position ?? reference.groups.length },
    extra: (fields, set) => (
      <NumberInput
        label={t("reference.position")}
        description={t("reference.positionHint")}
        min={0}
        value={fields.position as number}
        onChange={(value) => set({ position: Number(value) || 0 })}
      />
    ),
    body: (names, fields) => ({ names, position: fields.position }),
  });

  const categoryEditor = (
    groupId: string,
    item?: Reference["categories"][number],
  ): EditorState => ({
    title: item ? t("reference.editCategory") : t("reference.newCategory"),
    kind: "categories",
    id: item?.id,
    names: item?.names ?? {},
    fields: {
      groupId: item?.groupId ?? groupId,
      code: item?.code ?? "",
      direction: item?.direction ?? "expense",
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
          label={t("reference.direction")}
          description={t("reference.directionHint")}
          data={directionOptions}
          allowDeselect={false}
          value={fields.direction as string}
          onChange={(value) => value && set({ direction: value as Direction })}
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

  return (
    <Stack>
      {canEdit && (
        <Group>
          <Button onClick={() => openEditor(groupEditor())}>{t("reference.newGroup")}</Button>
        </Group>
      )}
      {groups.length === 0 && <Text c="dimmed">{t("reference.emptyCategories")}</Text>}
      {groups.map((group) => {
        const categories = visible(reference.categories.filter((c) => c.groupId === group.id));
        return (
          <Paper key={group.id} withBorder p="sm">
            <Group justify="space-between" mb="xs">
              <Group gap="xs">
                <Title order={4}>{nameOf(group.names)}</Title>
                <ArchivedBadge archived={group.archived} />
              </Group>
              <ItemMenu
                bookId={bookId}
                kind="groups"
                id={group.id}
                archived={group.archived}
                canEdit={canEdit}
                onEdit={() => openEditor(groupEditor(group))}
              >
                <Menu.Item onClick={() => openEditor(categoryEditor(group.id))}>
                  {t("reference.newCategory")}
                </Menu.Item>
              </ItemMenu>
            </Group>
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
                            {t(`directions.${item.direction}`)}
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
          </Paper>
        );
      })}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Accounts and payment types
// ---------------------------------------------------------------------------

function AccountsTab({ bookId, reference, canEdit, showArchived, openEditor }: TabProps) {
  const { t, i18n } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const accounts = reference.accounts
    .filter((a) => showArchived || !a.archived)
    .sort((a, b) => nameOf(a.names).localeCompare(nameOf(b.names)));

  const editor = (item?: Reference["accounts"][number]): EditorState => ({
    title: item ? t("reference.editAccount") : t("reference.newAccount"),
    kind: "accounts",
    id: item?.id,
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
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("reference.name")}</Table.Th>
              <Table.Th>{t("reference.kind")}</Table.Th>
              <Table.Th>{t("books.currency")}</Table.Th>
              <Table.Th>{t("reference.threshold")}</Table.Th>
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
                <Table.Td w={50}>
                  <ItemMenu
                    bookId={bookId}
                    kind="accounts"
                    id={item.id}
                    archived={item.archived}
                    canEdit={canEdit}
                    onEdit={() => openEditor(editor(item))}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
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
// Page
// ---------------------------------------------------------------------------

interface TabProps {
  bookId: string;
  reference: Reference;
  canEdit: boolean;
  showArchived: boolean;
  openEditor: (state: EditorState) => void;
}

export function ReferenceData({ bookId, canEdit }: { bookId: string; canEdit: boolean }) {
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
