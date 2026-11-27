import { ActionIcon, Alert, Button, Group, Modal, Select, Stack, TextInput } from "@mantine/core";
import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { currencyOptions } from "../options";
import { useBook } from "./Book";
import { useCreateItem, useNameOf, useReference, type Reference } from "../reference";

/**
 * Creating a reference item without leaving what one is doing: an account, a
 * sub-category (with its category and group if needed). The
 * item gets its name in the book's default language; the reference data screen
 * holds the rest.
 */

export type Creatable = "account" | "subCategory";

/** Choosing "new" in a list of categories or groups. */
const NEW = "new";

/** A select with a button beside it to create what the list lacks. */
export function WithCreate({
  children,
  label,
  onCreate,
}: {
  children: ReactNode;
  /** What the button creates, for screen readers and the tooltip. */
  label: string;
  onCreate: () => void;
}) {
  return (
    <Group gap={4} wrap="nowrap" align="flex-end">
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <ActionIcon
        variant="default"
        size="input-xs"
        aria-label={label}
        title={label}
        onClick={onCreate}
      >
        +
      </ActionIcon>
    </Group>
  );
}

interface Props {
  bookId: string;
  /** A name to start from, such as the bank's category of a line. */
  initialName?: string;
  onClose: () => void;
  /** The id of the item just created. */
  onCreated: (id: string) => void;
}

export function QuickCreate({ kind, ...props }: Props & { kind: Creatable }) {
  const reference = useReference(props.bookId);
  if (!reference.data) return null;
  const Form = { account: AccountForm, subCategory: SubCategoryForm }[kind];
  return <Form {...props} reference={reference.data} />;
}

type FormProps = Props & { reference: Reference };

function Dialog({
  title,
  error,
  pending,
  ready,
  onClose,
  onSubmit,
  children,
}: {
  title: string;
  error: Error | null;
  pending: boolean;
  ready: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  function submit(event: FormEvent) {
    event.preventDefault();
    // A dialog can open above another form: its submit stays its own.
    event.stopPropagation();
    // A refused creation is shown by the mutation; the dialog stays open.
    if (ready) onSubmit().catch(() => undefined);
  }
  return (
    // Above the rule form, under the lists of the selects.
    <Modal opened onClose={onClose} title={title} zIndex={250}>
      <form onSubmit={submit}>
        <Stack>
          {children}
          {error && <Alert color="red">{t("common.error", { message: error.message })}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!ready} loading={pending}>
              {t("common.create")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function AccountForm({ bookId, initialName, onClose, onCreated, reference }: FormProps) {
  const { t, i18n } = useTranslation();
  const create = useCreateItem(bookId);
  const [name, setName] = useState(initialName ?? "");
  const book = useBook(bookId);
  // The book's currency until another one is chosen.
  const [chosen, setCurrency] = useState<string | null>(null);
  const currency = chosen ?? book.data?.currency ?? "";
  return (
    <Dialog
      title={t("reference.newAccount")}
      error={create.error}
      pending={create.isPending}
      ready={name.trim() !== "" && currency !== ""}
      onClose={onClose}
      onSubmit={async () => {
        const { id } = await create.mutateAsync({
          kind: "accounts",
          body: {
            names: { [reference.defaultLanguage]: name.trim() },
            currency,
          },
        });
        onCreated(id);
        onClose();
      }}
    >
      <TextInput
        label={t("reference.itemName")}
        required
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        data-autofocus
      />
      <Select
        label={t("books.currency")}
        searchable
        allowDeselect={false}
        data={currencyOptions(i18n.language)}
        value={currency}
        onChange={(value) => value && setCurrency(value)}
      />
    </Dialog>
  );
}

/** The number after the highest numeric category code. */
function nextCode(reference: Reference): string {
  const numbers = reference.categories.map((c) => Number(c.code)).filter(Number.isInteger);
  return String(Math.max(0, ...numbers) + 1);
}

function SubCategoryForm({ bookId, initialName, onClose, onCreated, reference }: FormProps) {
  const { t } = useTranslation();
  const nameOf = useNameOf(reference.defaultLanguage);
  const create = useCreateItem(bookId);
  const named = (name: string) => ({ [reference.defaultLanguage]: name.trim() });

  const categories = reference.categories.filter((c) => !c.archived);
  const groups = reference.groups.filter((g) => !g.archived);
  const natures = reference.natures.filter((n) => !n.archived);

  const [name, setName] = useState(initialName ?? "");
  const [categoryId, setCategoryId] = useState<string | null>(categories.length ? null : NEW);
  const [categoryName, setCategoryName] = useState("");
  const [code, setCode] = useState(() => nextCode(reference));
  const [natureId, setNatureId] = useState<string | null>(
    () => (natures.find((n) => !n.transfer && n.sign === -1) ?? natures[0])?.id ?? null,
  );
  const [groupId, setGroupId] = useState<string | null>(groups.length ? null : NEW);
  const [groupName, setGroupName] = useState("");

  const newCategory = categoryId === NEW;
  const newGroup = newCategory && groupId === NEW;
  const ready =
    name.trim() !== "" &&
    categoryId !== null &&
    (!newCategory ||
      (categoryName.trim() !== "" &&
        code.trim() !== "" &&
        natureId !== null &&
        groupId !== null &&
        (!newGroup || groupName.trim() !== "")));

  return (
    <Dialog
      title={t("reference.newSubCategory")}
      error={create.error}
      pending={create.isPending}
      ready={ready}
      onClose={onClose}
      onSubmit={async () => {
        let category = categoryId!;
        if (newCategory) {
          let group = groupId!;
          if (newGroup) {
            group = (
              await create.mutateAsync({ kind: "groups", body: { names: named(groupName) } })
            ).id;
            // Kept if what follows is refused, so a retry does not make it twice.
            setGroupId(group);
          }
          category = (
            await create.mutateAsync({
              kind: "categories",
              body: { names: named(categoryName), code: code.trim(), natureId, groupId: group },
            })
          ).id;
          setCategoryId(category);
        }
        const { id } = await create.mutateAsync({
          kind: "sub-categories",
          body: { names: named(name), categoryId: category },
        });
        onCreated(id);
        onClose();
      }}
    >
      <TextInput
        label={t("reference.itemName")}
        required
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        data-autofocus
      />
      <Select
        label={t("reference.category")}
        required
        searchable
        data={[
          { value: NEW, label: t("reference.newCategory") },
          ...categories.map((c) => ({ value: c.id, label: `${c.code} ${nameOf(c.names)}` })),
        ]}
        value={categoryId}
        onChange={setCategoryId}
      />
      {newCategory && (
        <>
          <Group grow align="flex-start">
            <TextInput
              label={t("reference.categoryName")}
              required
              maxLength={100}
              value={categoryName}
              onChange={(e) => setCategoryName(e.currentTarget.value)}
            />
            <TextInput
              label={t("reference.code")}
              required
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
            />
          </Group>
          <Select
            label={t("reference.nature")}
            required
            allowDeselect={false}
            data={natures.map((n) => ({ value: n.id, label: nameOf(n.names) }))}
            value={natureId}
            onChange={setNatureId}
          />
          <Select
            label={t("reference.group")}
            required
            data={[
              { value: NEW, label: t("reference.newGroup") },
              ...groups.map((g) => ({ value: g.id, label: nameOf(g.names) })),
            ]}
            value={groupId}
            onChange={setGroupId}
          />
          {newGroup && (
            <TextInput
              label={t("reference.groupName")}
              required
              maxLength={100}
              value={groupName}
              onChange={(e) => setGroupName(e.currentTarget.value)}
            />
          )}
        </>
      )}
    </Dialog>
  );
}
