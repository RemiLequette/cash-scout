import {
  Alert,
  Button,
  Center,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "../auth";

export function SignIn() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    const { error } = await authClient.signIn.email({ email, password });
    setPending(false);
    setFailed(!!error);
  }

  return (
    <Center mih="70vh">
      <Paper withBorder p="xl" w={360} component="form" onSubmit={submit}>
        <Stack>
          <Title order={2}>{t("signIn.title")}</Title>
          {failed && <Alert color="red">{t("signIn.failed")}</Alert>}
          <TextInput
            label={t("signIn.email")}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <PasswordInput
            label={t("signIn.password")}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <Button type="submit" loading={pending}>
            {t("signIn.submit")}
          </Button>
          <Text size="xs" c="dimmed">
            {t("signIn.forgot")}
          </Text>
        </Stack>
      </Paper>
    </Center>
  );
}
