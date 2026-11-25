import { formatMoney, parseAmount, type StatementPreview as Preview } from "@cash-scout/domain";
import { Alert, FileInput, Group, Paper, Select, Stack, Table, Text, Title } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api";
import { useNameOf, useReference } from "../reference";

/** The formats of statements the API can read. */
function usePresets(bookId: string) {
  return useQuery({
    queryKey: ["books", bookId, "statements", "presets"],
    queryFn: async () => {
      const response = await fetch(`/api/books/${bookId}/statements/presets`);
      if (!response.ok) throw new ApiError(`HTTP ${response.status}`, response.status);
      return (await response.json()) as { id: string; name: string }[];
    },
  });
}

/** Sends the file to be read; nothing is saved, the answer is what the file holds. */
function usePreview(bookId: string) {
  return useMutation({
    mutationFn: async (input: { file: File; preset: string; accountId: string }) => {
      const query = new URLSearchParams({ preset: input.preset, account: input.accountId });
      const response = await fetch(`/api/books/${bookId}/statements/preview?${query}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: await input.file.arrayBuffer(),
      });
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const body = (await response.json()) as { error?: string };
          if (typeof body.error === "string") message = body.error;
        } catch {
          // No JSON body.
        }
        throw new ApiError(message, response.status);
      }
      return (await response.json()) as Preview;
    },
  });
}

/**
 * Reads a bank statement and shows what it holds, line by line, before anything
 * is imported. For now it only shows: the import itself comes next.
 */
export function Statements({ bookId }: { bookId: string }) {
  const { t, i18n } = useTranslation();
  const reference = useReference(bookId);
  const presets = usePresets(bookId);
  const preview = usePreview(bookId);
  const nameOf = useNameOf(reference.data?.defaultLanguage);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const accounts = (reference.data?.accounts ?? [])
    .filter((a) => a.kind === "bank" && !a.archived)
    .sort((a, b) => nameOf(a.names).localeCompare(nameOf(b.names)));

  function read(next: { accountId: string | null; presetId: string | null; file: File | null }) {
    setAccountId(next.accountId);
    setPresetId(next.presetId);
    setFile(next.file);
    if (next.accountId && next.presetId && next.file) {
      preview.mutate({ file: next.file, preset: next.presetId, accountId: next.accountId });
    } else {
      preview.reset();
    }
  }

  const money = (amount: string, currency: string) =>
    formatMoney(parseAmount(amount, currency), i18n.language);

  return (
    <Stack>
      <Title order={4}>{t("statements.title")}</Title>
      <Text size="sm" c="dimmed">
        {t("statements.intro")}
      </Text>
      <Paper withBorder p="md">
        <Group align="flex-end" grow>
          <Select
            label={t("statements.account")}
            data={accounts.map((a) => ({ value: a.id, label: nameOf(a.names) }))}
            value={accountId}
            onChange={(value) => read({ accountId: value, presetId, file })}
          />
          <Select
            label={t("statements.format")}
            data={(presets.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
            value={presetId}
            onChange={(value) => read({ accountId, presetId: value, file })}
          />
          <FileInput
            label={t("statements.file")}
            placeholder={t("statements.choose")}
            accept=".csv,text/csv"
            clearable
            value={file}
            onChange={(value) => read({ accountId, presetId, file: value })}
          />
        </Group>
      </Paper>
      {preview.error && (
        <Alert color="red">{t("common.error", { message: preview.error.message })}</Alert>
      )}
      {preview.data && <PreviewResult preview={preview.data} money={money} />}
    </Stack>
  );
}

function PreviewResult({
  preview,
  money,
}: {
  preview: Preview;
  money: (amount: string, currency: string) => string;
}) {
  const { t } = useTranslation();
  const { lines, errors, balanceBreaks, accountNumbers, currency } = preview;
  const first = lines.at(-1)?.date;
  const last = lines[0]?.date;
  const dates = lines.map((l) => l.date).sort();
  return (
    <Stack>
      <Paper withBorder p="md">
        <Stack gap={4}>
          <Text fw={600}>
            {t("statements.summary", {
              count: lines.length,
              from: dates[0] ?? first ?? "",
              to: dates.at(-1) ?? last ?? "",
            })}
          </Text>
          <Text size="sm">{t("statements.total", { amount: money(preview.total, currency) })}</Text>
          {accountNumbers.length > 0 && (
            <Text size="sm" c="dimmed">
              {t("statements.accountNumbers", { numbers: accountNumbers.join(", ") })}
            </Text>
          )}
          <Text size="sm" c="dimmed">
            {t("statements.nothingSaved")}
          </Text>
        </Stack>
      </Paper>
      {errors.length > 0 && (
        <Alert color="red" title={t("statements.unreadable", { count: errors.length })}>
          {errors.slice(0, 10).map((e) => (
            <Text size="sm" key={e.row}>
              {t("statements.errorLine", { row: e.row, message: e.message })}
            </Text>
          ))}
        </Alert>
      )}
      {balanceBreaks.length > 0 && (
        <Alert color="orange" title={t("statements.breaks", { count: balanceBreaks.length })}>
          <Text size="sm" mb={4}>
            {t("statements.breaksHint")}
          </Text>
          {balanceBreaks.slice(0, 10).map((b) => (
            <Text size="sm" key={b.date}>
              {t("statements.breakLine", {
                date: b.date,
                expected: money(b.expected, currency),
                found: money(b.found, currency),
              })}
            </Text>
          ))}
        </Alert>
      )}
      <Table.ScrollContainer minWidth={700} h={520}>
        <Table stickyHeader highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("statements.date")}</Table.Th>
              <Table.Th>{t("statements.counterparty")}</Table.Th>
              <Table.Th>{t("statements.label")}</Table.Th>
              <Table.Th>{t("statements.bankCategory")}</Table.Th>
              <Table.Th ta="right">{t("statements.amount")}</Table.Th>
              <Table.Th ta="right">{t("statements.balance")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lines.map((line) => (
              <Table.Tr key={line.row}>
                <Table.Td style={{ whiteSpace: "nowrap" }}>{line.date}</Table.Td>
                <Table.Td>{line.counterparty}</Table.Td>
                <Table.Td>
                  <Text size="sm" title={line.memo || undefined}>
                    {line.label}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {line.bankCategory}
                  </Text>
                </Table.Td>
                <Table.Td
                  ta="right"
                  c={line.amount.startsWith("-") ? "red" : undefined}
                  style={{ whiteSpace: "nowrap" }}
                >
                  {money(line.amount, currency)}
                </Table.Td>
                <Table.Td ta="right" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                  {line.balance === null ? "" : money(line.balance, currency)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
