import { formatMoney, parseAmount, type StatementPreview as Preview } from "@cash-scout/domain";
import {
  ActionIcon,
  Alert,
  Button,
  FileInput,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNameOf, useReference } from "../reference";
import { useBatches, useDeleteBatch, useKeepBatch, usePresets, usePreview } from "../statements";
import { BatchReview } from "./BatchReview";
import { RulesPanel } from "./Rules";

type Money = (amount: string, currency: string) => string;

function useMoney(): Money {
  const { i18n } = useTranslation();
  return (amount, currency) => formatMoney(parseAmount(amount, currency), i18n.language);
}

function ErrorAlert({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  return error ? <Alert color="red">{t("common.error", { message: error.message })}</Alert> : null;
}

/**
 * Reads a bank statement and shows what it holds, line by line, then keeps it
 * as a batch, reviewed line by line and imported into the journal.
 */
export function Statements({ bookId }: { bookId: string }) {
  const { t } = useTranslation();
  const reference = useReference(bookId);
  const presets = usePresets(bookId);
  const preview = usePreview(bookId);
  const keep = useKeepBatch(bookId);
  const nameOf = useNameOf(reference.data?.defaultLanguage);
  const money = useMoney();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kept, setKept] = useState<{ lines: number } | null>(null);

  const accounts = (reference.data?.accounts ?? [])
    .filter((a) => a.kind === "bank" && !a.archived)
    .sort((a, b) => nameOf(a.names).localeCompare(nameOf(b.names)));

  function read(next: { accountId: string | null; presetId: string | null; file: File | null }) {
    setAccountId(next.accountId);
    setPresetId(next.presetId);
    setFile(next.file);
    setKept(null);
    keep.reset();
    if (next.accountId && next.presetId && next.file) {
      preview.mutate({ file: next.file, preset: next.presetId, accountId: next.accountId });
    } else {
      preview.reset();
    }
  }

  function keepBatch() {
    if (!accountId || !presetId || !file) return;
    keep.mutate(
      { file, preset: presetId, accountId },
      {
        onSuccess: (batch) => {
          setKept({ lines: batch.lines });
          setAccountId(null);
          setPresetId(null);
          setFile(null);
          preview.reset();
        },
      },
    );
  }

  return (
    <Stack gap="xl">
      <Stack>
        <Title order={4}>{t("statements.title")}</Title>
        <Text size="sm" c="dimmed">
          {t("statements.intro")}
        </Text>
        <Paper withBorder p="md">
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
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
          </SimpleGrid>
        </Paper>
        <ErrorAlert error={preview.error ?? keep.error} />
        {kept && <Alert color="teal">{t("statements.kept", { count: kept.lines })}</Alert>}
        {preview.data && (
          <PreviewResult
            preview={preview.data}
            money={money}
            keeping={keep.isPending}
            onKeep={keepBatch}
          />
        )}
      </Stack>
      <SavedBatches bookId={bookId} />
      <RulesPanel bookId={bookId} />
    </Stack>
  );
}

function PreviewResult({
  preview,
  money,
  keeping,
  onKeep,
}: {
  preview: Preview;
  money: Money;
  keeping: boolean;
  onKeep: () => void;
}) {
  const { t } = useTranslation();
  const { lines, errors, balanceBreaks, accountNumbers, currency } = preview;
  const dates = lines.map((l) => l.date).sort();
  return (
    <Stack>
      <Paper withBorder p="md">
        <Group justify="space-between" align="flex-start">
          <Stack gap={4}>
            <Text fw={600}>
              {t("statements.summary", {
                count: lines.length,
                from: dates[0] ?? "",
                to: dates.at(-1) ?? "",
              })}
            </Text>
            <Text size="sm">
              {t("statements.total", { amount: money(preview.total, currency) })}
            </Text>
            {accountNumbers.length > 0 && (
              <Text size="sm" c="dimmed">
                {t("statements.accountNumbers", { numbers: accountNumbers.join(", ") })}
              </Text>
            )}
          </Stack>
          <Button onClick={onKeep} loading={keeping} disabled={lines.length === 0}>
            {t("statements.keep")}
          </Button>
        </Group>
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
      <LinesTable lines={lines} currency={currency} money={money} />
    </Stack>
  );
}

/** The statements kept for review, and the lines of the one that is open. */
function SavedBatches({ bookId }: { bookId: string }) {
  const { t, i18n } = useTranslation();
  const reference = useReference(bookId);
  const nameOf = useNameOf(reference.data?.defaultLanguage);
  const batches = useBatches(bookId);
  const remove = useDeleteBatch(bookId);
  const [openId, setOpenId] = useState<string | null>(null);
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });

  if (!batches.data || batches.data.length === 0) return null;
  return (
    <Stack>
      <Title order={4}>{t("statements.saved")}</Title>
      <ErrorAlert error={batches.error ?? remove.error} />
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("statements.file")}</Table.Th>
            <Table.Th>{t("statements.account")}</Table.Th>
            <Table.Th>{t("statements.period")}</Table.Th>
            <Table.Th ta="right">{t("statements.lines")}</Table.Th>
            <Table.Th ta="right">{t("statements.toReview")}</Table.Th>
            <Table.Th>{t("statements.addedOn")}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {batches.data.map((batch) => (
            <Table.Tr
              key={batch.id}
              bg={batch.id === openId ? "var(--mantine-color-blue-light)" : undefined}
            >
              <Table.Td>{batch.fileName}</Table.Td>
              <Table.Td>
                {nameOf(
                  reference.data?.accounts.find((a) => a.id === batch.accountId)?.names ?? {},
                )}
              </Table.Td>
              <Table.Td style={{ whiteSpace: "nowrap" }}>
                {batch.from} → {batch.to}
              </Table.Td>
              <Table.Td ta="right">{batch.lines}</Table.Td>
              <Table.Td ta="right">{batch.toReview}</Table.Td>
              <Table.Td>{date.format(new Date(batch.createdAt))}</Table.Td>
              <Table.Td>
                <Group gap="xs" justify="flex-end" wrap="nowrap">
                  <Button
                    size="compact-sm"
                    variant="light"
                    onClick={() => setOpenId(batch.id === openId ? null : batch.id)}
                  >
                    {batch.id === openId ? t("statements.close") : t("statements.open")}
                  </Button>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={t("common.delete")}
                    loading={remove.isPending && remove.variables === batch.id}
                    onClick={() => {
                      if (
                        !window.confirm(t("statements.deleteConfirm", { name: batch.fileName }))
                      ) {
                        return;
                      }
                      remove.mutate(batch.id, {
                        onSuccess: () =>
                          setOpenId((current) => (current === batch.id ? null : current)),
                      });
                    }}
                  >
                    ✕
                  </ActionIcon>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {openId && <BatchReview key={openId} bookId={bookId} batchId={openId} />}
    </Stack>
  );
}

function LinesTable({
  lines,
  currency,
  money,
}: {
  lines: Preview["lines"];
  currency: string;
  money: Money;
}) {
  const { t } = useTranslation();
  return (
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
  );
}
