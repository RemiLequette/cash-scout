import { Alert, Button, Group, PasswordInput, Stack, Text } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { authClient } from "../auth";

/** Same minimum as the API (better-auth `minPasswordLength`). */
const MIN_LENGTH = 10;

/** Turns a better-auth { data, error } result into a value or a thrown error. */
async function check<T>(result: Promise<{ data: T | null; error: { message?: string } | null }>) {
  const { data, error } = await result;
  if (error) throw new Error(error.message ?? "Error");
  return data as T;
}

/** A new password typed twice; returns an error key when they do not fit. */
function useNewPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const problem =
    password.length < MIN_LENGTH
      ? "password.tooShort"
      : password !== confirm
        ? "password.mismatch"
        : undefined;
  return { password, setPassword, confirm, setConfirm, problem };
}

function NewPasswordFields({
  value,
  autofocus = false,
}: {
  value: ReturnType<typeof useNewPassword>;
  autofocus?: boolean;
}) {
  const { t } = useTranslation();
  const [touched, setTouched] = useState(false);
  return (
    <>
      <PasswordInput
        label={t("password.new")}
        description={t("password.newHint", { min: MIN_LENGTH })}
        required
        autoComplete="new-password"
        value={value.password}
        onChange={(e) => value.setPassword(e.currentTarget.value)}
        data-autofocus={autofocus || undefined}
      />
      <PasswordInput
        label={t("password.confirm")}
        required
        autoComplete="new-password"
        value={value.confirm}
        onBlur={() => setTouched(true)}
        error={touched && value.problem ? t(value.problem, { min: MIN_LENGTH }) : undefined}
        onChange={(e) => value.setConfirm(e.currentTarget.value)}
      />
    </>
  );
}

function Buttons({ pending, onClose }: { pending: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Group justify="flex-end">
      <Button variant="default" onClick={onClose}>
        {t("common.cancel")}
      </Button>
      <Button type="submit" loading={pending}>
        {t("common.save")}
      </Button>
    </Group>
  );
}

/**
 * The super user sets a new password for a user who forgot theirs, and ends
 * the user's open sessions.
 */
export function ResetPassword({
  user,
  onClose,
}: {
  user: { id: string; email: string };
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const value = useNewPassword();
  const [done, setDone] = useState(false);
  const reset = useMutation({
    mutationFn: async () => {
      await check(
        authClient.admin.setUserPassword({ userId: user.id, newPassword: value.password }),
      );
      await check(authClient.admin.revokeUserSessions({ userId: user.id }));
    },
    onSuccess: () => setDone(true),
  });

  if (done) {
    return (
      <Stack>
        <Alert color="green">{t("password.resetDone", { email: user.email })}</Alert>
        <Group justify="flex-end">
          <Button onClick={onClose}>{t("password.close")}</Button>
        </Group>
      </Stack>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.problem) reset.mutate();
  }

  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Text size="sm">{t("password.resetIntro", { email: user.email })}</Text>
        {reset.error && (
          <Alert color="red">{t("common.error", { message: reset.error.message })}</Alert>
        )}
        <NewPasswordFields value={value} autofocus />
        <Buttons pending={reset.isPending} onClose={onClose} />
      </Stack>
    </form>
  );
}

/** A signed-in user changes their own password; their other sessions end. */
export function ChangePassword({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const value = useNewPassword();
  const change = useMutation({
    mutationFn: () =>
      check(
        authClient.changePassword({
          currentPassword: current,
          newPassword: value.password,
          revokeOtherSessions: true,
        }),
      ),
    onSuccess: onClose,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (current && !value.problem) change.mutate();
  }

  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        {change.error && <Alert color="red">{t("password.changeFailed")}</Alert>}
        <PasswordInput
          label={t("password.current")}
          required
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.currentTarget.value)}
          data-autofocus
        />
        <NewPasswordFields value={value} />
        <Text size="xs" c="dimmed">
          {t("password.changeHint")}
        </Text>
        <Buttons pending={change.isPending} onClose={onClose} />
      </Stack>
    </form>
  );
}
