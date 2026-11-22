import { bookRoles, hasRole, type BookRole } from "@cash-scout/domain";
import {
  Alert,
  Badge,
  Button,
  Group,
  MultiSelect,
  Paper,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "../api";
import { useSession } from "../auth";
import { languageOptions } from "../options";
import { Journal } from "./Journal";
import { ReferenceData } from "./Reference";

function ErrorAlert({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  return error ? <Alert color="red">{t("common.error", { message: error.message })}</Alert> : null;
}

interface BookData {
  id: string;
  name: string;
  currency: string;
  defaultLanguage: string;
  languages: string[];
  role: BookRole;
}

function BookView({ bookId }: { bookId: string }) {
  const { t } = useTranslation();
  const book = useQuery({
    queryKey: ["books", bookId],
    queryFn: () => unwrap(api.books[":bookId"].$get({ param: { bookId } })),
  });
  if (book.error) return <ErrorAlert error={book.error} />;
  if (!book.data) return null;
  const { role } = book.data;
  return (
    <Stack>
      <Group>
        <Title order={2}>{book.data.name}</Title>
        <Badge variant="light">{book.data.currency}</Badge>
        <Badge variant="outline">{t(`roles.${role}`)}</Badge>
      </Group>
      <Tabs defaultValue="journal" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="journal">{t("book.journal")}</Tabs.Tab>
          <Tabs.Tab value="reference">{t("book.referenceData")}</Tabs.Tab>
          <Tabs.Tab value="settings">{t("book.settingsAndMembers")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="journal" pt="md">
          <Journal
            bookId={bookId}
            bookCurrency={book.data.currency}
            canEdit={hasRole(role, "editor")}
          />
        </Tabs.Panel>
        <Tabs.Panel value="reference" pt="md">
          <ReferenceData bookId={bookId} canEdit={hasRole(role, "editor")} />
        </Tabs.Panel>
        <Tabs.Panel value="settings" pt="md">
          <Stack>
            {/* Keyed so the form restarts from the saved values when they change. */}
            <SettingsForm
              key={`${book.data.name}|${book.data.defaultLanguage}|${book.data.languages.join()}`}
              book={book.data}
            />
            <Members bookId={bookId} isOwner={role === "owner"} bookName={book.data.name} />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

function SettingsForm({ book }: { book: BookData }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const bookId = book.id;
  const [name, setName] = useState(book.name);
  const [defaultLanguage, setDefaultLanguage] = useState<string | null>(book.defaultLanguage);
  const [languages, setLanguages] = useState<string[]>(book.languages);
  const isOwner = book.role === "owner";
  const options = languageOptions(i18n.language);

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.books[":bookId"].$patch({
          param: { bookId },
          json: { name, defaultLanguage: defaultLanguage ?? "", languages },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["books"] }),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Stack>
      <Paper withBorder p="md" component="form" onSubmit={submit}>
        <Stack>
          <Title order={4}>{t("book.settings")}</Title>
          <ErrorAlert error={save.error} />
          <TextInput
            label={t("books.name")}
            required
            maxLength={100}
            disabled={!isOwner}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <MultiSelect
            label={t("book.languages")}
            description={t("book.languagesHint")}
            required
            disabled={!isOwner}
            data={options}
            value={languages}
            onChange={(value) => {
              setLanguages(value);
              if (defaultLanguage && !value.includes(defaultLanguage)) {
                setDefaultLanguage(value[0] ?? null);
              }
            }}
          />
          <Select
            label={t("books.defaultLanguage")}
            description={t("books.defaultLanguageHint")}
            required
            disabled={!isOwner}
            data={options.filter((o) => languages.includes(o.value))}
            value={defaultLanguage}
            onChange={setDefaultLanguage}
          />
          {isOwner && (
            <Group justify="flex-end">
              <Button type="submit" loading={save.isPending}>
                {t("common.save")}
              </Button>
            </Group>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

function Members({
  bookId,
  isOwner,
  bookName,
}: {
  bookId: string;
  isOwner: boolean;
  bookName: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const me = session?.user.id;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<BookRole>("viewer");

  const members = useQuery({
    queryKey: ["books", bookId, "members"],
    queryFn: () => unwrap(api.books[":bookId"].members.$get({ param: { bookId } })),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["books"] });

  const add = useMutation({
    mutationFn: () =>
      unwrap(api.books[":bookId"].members.$post({ param: { bookId }, json: { email, role } })),
    onSuccess: async () => {
      setEmail("");
      await refresh();
    },
  });
  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: BookRole }) =>
      unwrap(
        api.books[":bookId"].members[":userId"].$patch({
          param: { bookId, userId: v.userId },
          json: { role: v.role },
        }),
      ),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (userId: string) =>
      unwrap(api.books[":bookId"].members[":userId"].$delete({ param: { bookId, userId } })),
    onSuccess: async (_, userId) => {
      if (userId === me) {
        await navigate({ to: "/" });
      }
      await refresh();
    },
  });
  const deleteBook = useMutation({
    mutationFn: () => unwrap(api.books[":bookId"].$delete({ param: { bookId } })),
    onSuccess: async () => {
      await navigate({ to: "/" });
      await refresh();
    },
  });

  const roleOptions = bookRoles.map((r) => ({ value: r, label: t(`roles.${r}`) }));

  function submit(event: FormEvent) {
    event.preventDefault();
    add.mutate();
  }

  return (
    <Paper withBorder p="md">
      <Stack>
        <Title order={4}>{t("book.members")}</Title>
        <ErrorAlert
          error={members.error ?? add.error ?? changeRole.error ?? remove.error ?? deleteBook.error}
        />
        <Table>
          <Table.Tbody>
            {members.data?.map((member) => (
              <Table.Tr key={member.userId}>
                <Table.Td>
                  {member.name}
                  {member.userId === me && (
                    <Text span c="dimmed">
                      {" "}
                      ({t("book.you")})
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{member.email}</Table.Td>
                <Table.Td w={170}>
                  {isOwner ? (
                    <Select
                      aria-label={t("books.role")}
                      data={roleOptions}
                      value={member.role}
                      allowDeselect={false}
                      onChange={(value) =>
                        value &&
                        changeRole.mutate({ userId: member.userId, role: value as BookRole })
                      }
                    />
                  ) : (
                    t(`roles.${member.role}`)
                  )}
                </Table.Td>
                <Table.Td w={120}>
                  {isOwner && member.userId !== me && (
                    <Button
                      variant="subtle"
                      color="red"
                      size="xs"
                      onClick={() => remove.mutate(member.userId)}
                    >
                      {t("book.remove")}
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {isOwner && (
          <Group component="form" onSubmit={submit} align="flex-end">
            <TextInput
              label={t("book.memberEmail")}
              type="email"
              required
              style={{ flex: 1 }}
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <Select
              aria-label={t("books.role")}
              w={150}
              data={roleOptions}
              value={role}
              allowDeselect={false}
              onChange={(value) => value && setRole(value as BookRole)}
            />
            <Button type="submit" loading={add.isPending}>
              {t("book.addMember")}
            </Button>
          </Group>
        )}
        <Group justify="flex-end">
          {me && (
            <Button variant="default" onClick={() => remove.mutate(me)}>
              {t("book.leave")}
            </Button>
          )}
          {isOwner && (
            <Button
              color="red"
              onClick={() =>
                window.confirm(t("book.deleteConfirm", { name: bookName })) && deleteBook.mutate()
              }
            >
              {t("book.deleteBook")}
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}

export function Book({ bookId }: { bookId: string }) {
  return <BookView bookId={bookId} />;
}
