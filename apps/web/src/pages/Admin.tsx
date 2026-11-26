import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  PasswordInput,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { authClient, useSession } from "../auth";
import { ResetPassword } from "./Password";
import { DataTable } from "../table";

/** Turns a better-auth { data, error } result into a value or a thrown error. */
async function check<T>(result: Promise<{ data: T | null; error: { message?: string } | null }>) {
  const { data, error } = await result;
  if (error) throw new Error(error.message ?? "Error");
  return data as T;
}

function CreateUser({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const create = useMutation({
    mutationFn: () => check(authClient.admin.createUser({ name, email, password, role: "user" })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      onClose();
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
        label={t("admin.name")}
        required
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        data-autofocus
      />
      <TextInput
        label={t("admin.email")}
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.currentTarget.value)}
      />
      <PasswordInput
        label={t("admin.password")}
        description={t("admin.passwordHint")}
        required
        minLength={10}
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
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

export function Admin() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const [opened, { open, close }] = useDisclosure(false);
  const [resetFor, setResetFor] = useState<{ id: string; email: string } | null>(null);
  const isAdmin = session?.user.role === "admin";

  const users = useQuery({
    queryKey: ["users"],
    enabled: isAdmin,
    queryFn: () => check(authClient.admin.listUsers({ query: { limit: 200 } })),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => check(authClient.admin.removeUser({ userId })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  if (!isAdmin) {
    return <Alert color="yellow">{t("admin.forbidden")}</Alert>;
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t("admin.title")}</Title>
        <Button onClick={open}>{t("admin.create")}</Button>
      </Group>
      <Text c="dimmed">{t("admin.intro")}</Text>
      {(users.error ?? remove.error) && (
        <Alert color="red">
          {t("common.error", { message: (users.error ?? remove.error)?.message })}
        </Alert>
      )}
      <DataTable minWidth={500}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("admin.name")}</Table.Th>
            <Table.Th>{t("admin.email")}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.data?.users.map((user) => (
            <Table.Tr key={user.id}>
              <Table.Td>
                {user.name}{" "}
                {user.role === "admin" && <Badge variant="light">{t("admin.superUser")}</Badge>}
              </Table.Td>
              <Table.Td>{user.email}</Table.Td>
              <Table.Td w={260}>
                {user.id !== session?.user.id && (
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Button variant="subtle" size="xs" onClick={() => setResetFor(user)}>
                      {t("password.reset")}
                    </Button>
                    <Button
                      variant="subtle"
                      color="red"
                      size="xs"
                      onClick={() =>
                        window.confirm(t("admin.removeConfirm", { email: user.email })) &&
                        remove.mutate(user.id)
                      }
                    >
                      {t("common.delete")}
                    </Button>
                  </Group>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </DataTable>
      <Modal opened={opened} onClose={close} title={t("admin.create")}>
        <CreateUser onClose={close} />
      </Modal>
      <Modal
        opened={resetFor !== null}
        onClose={() => setResetFor(null)}
        title={t("password.reset")}
      >
        {resetFor && <ResetPassword user={resetFor} onClose={() => setResetFor(null)} />}
      </Modal>
    </Stack>
  );
}
