import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { api, unwrap } from "../api";
import { currencyOptions, languageOptions } from "../options";
import { DataTable } from "../table";

export function useBooks() {
  return useQuery({ queryKey: ["books"], queryFn: () => unwrap(api.books.$get()) });
}

function CreateBook({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState<string | null>("EUR");
  const [defaultLanguage, setDefaultLanguage] = useState<string | null>(i18n.language.slice(0, 2));

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.books.$post({
          json: { name, currency: currency ?? "", defaultLanguage: defaultLanguage ?? "" },
        }),
      ),
    onSuccess: async (book) => {
      await queryClient.invalidateQueries({ queryKey: ["books"] });
      onClose();
      await navigate({ to: "/books/$bookId", params: { bookId: book.id } });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <Stack component="form" onSubmit={submit}>
      {create.error && (
        <Alert color="red">{t("common.error", { message: create.error.message })}</Alert>
      )}
      <TextInput
        label={t("books.name")}
        required
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        data-autofocus
      />
      <Select
        label={t("books.currency")}
        description={t("books.currencyHint")}
        required
        searchable
        data={currencyOptions(i18n.language)}
        value={currency}
        onChange={setCurrency}
      />
      <Select
        label={t("books.defaultLanguage")}
        description={t("books.defaultLanguageHint")}
        required
        data={languageOptions(i18n.language)}
        value={defaultLanguage}
        onChange={setDefaultLanguage}
      />
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={create.isPending}>
          {t("common.create")}
        </Button>
      </Group>
    </Stack>
  );
}

export function Books() {
  const { t } = useTranslation();
  const books = useBooks();
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t("books.title")}</Title>
        <Button onClick={open}>{t("books.create")}</Button>
      </Group>
      {books.error && (
        <Alert color="red">{t("common.error", { message: books.error.message })}</Alert>
      )}
      {books.data?.length === 0 && <Text c="dimmed">{t("books.empty")}</Text>}
      {books.data && books.data.length > 0 && (
        <DataTable minWidth={400} highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("books.name")}</Table.Th>
              <Table.Th>{t("books.currency")}</Table.Th>
              <Table.Th>{t("books.role")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {books.data.map((book) => (
              <Table.Tr key={book.id}>
                <Table.Td>
                  <Link to="/books/$bookId" params={{ bookId: book.id }}>
                    {book.name}
                  </Link>
                </Table.Td>
                <Table.Td>{book.currency}</Table.Td>
                <Table.Td>
                  <Badge variant="light">{t(`roles.${book.role}`)}</Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </DataTable>
      )}
      <Modal opened={opened} onClose={close} title={t("books.create")}>
        <CreateBook onClose={close} />
      </Modal>
    </Stack>
  );
}
