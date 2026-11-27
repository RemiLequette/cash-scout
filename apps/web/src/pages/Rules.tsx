import {
  parseAmount,
  ruleInputSchema,
  ruleMatches,
  type RuleInput,
  type RuleTarget,
} from "@cash-scout/domain";
import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNameOf, useReference, useSubCategoryOptions, type Reference } from "../reference";
import { useDeleteRule, useOrderRules, useRules, useSaveRule, type Rule } from "../statements";
import { QuickCreate, WithCreate } from "./QuickCreate";
import { DataTable } from "../table";

function ErrorAlert({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  return error ? <Alert color="red">{t("common.error", { message: error.message })}</Alert> : null;
}

/** The statement lines a rule form shows how many it would touch. */
export interface RuleSample {
  currency: string;
  /** A name to start a new sub-category from. */
  suggestedName?: string;
  lines: {
    amount: string;
    counterparty: string;
    label: string;
    memo: string;
    bankCategory: string;
  }[];
}

interface Draft {
  name: string;
  text: string;
  bankCategory: string;
  direction: "any" | "in" | "out";
  minAmount: string;
  maxAmount: string;
  subCategoryId: string | null;
  description: string;
  ignore: boolean;
}

const blank: Draft = {
  name: "",
  text: "",
  bankCategory: "",
  direction: "any",
  minAmount: "",
  maxAmount: "",
  subCategoryId: null,
  description: "",
  ignore: false,
};

export function draftOf(rule: Partial<Rule>): Draft {
  return {
    name: rule.name ?? "",
    text: rule.text ?? "",
    bankCategory: rule.bankCategory ?? "",
    direction: rule.direction ?? "any",
    minAmount: rule.minAmount ?? "",
    maxAmount: rule.maxAmount ?? "",
    subCategoryId: rule.subCategoryId ?? null,
    description: rule.description ?? "",
    ignore: rule.ignore ?? false,
  };
}

const input = (draft: Draft): RuleInput => ({
  name: draft.name.trim() || draft.text.trim() || draft.bankCategory.trim(),
  text: draft.text,
  bankCategory: draft.bankCategory,
  direction: draft.direction,
  minAmount: draft.minAmount.trim().replace(",", ".") || null,
  maxAmount: draft.maxAmount.trim().replace(",", ".") || null,
  subCategoryId: draft.ignore ? null : draft.subCategoryId,
  description: draft.description,
  ignore: draft.ignore,
});

/** Creates or changes a rule; with a sample of statement lines, says how many it fits. */
export function RuleForm(props: {
  bookId: string;
  ruleId?: string;
  initial: Draft;
  sample?: RuleSample;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const reference = useReference(props.bookId);
  return reference.data ? <RuleFormBody {...props} reference={reference.data} /> : null;
}

function RuleFormBody({
  bookId,
  ruleId,
  initial,
  sample,
  onClose,
  onSaved,
  reference,
}: {
  bookId: string;
  ruleId?: string;
  initial: Draft;
  sample?: RuleSample;
  onClose: () => void;
  onSaved?: () => void;
  reference: Reference;
}) {
  const { t } = useTranslation();
  const save = useSaveRule(bookId);
  const [draft, setDraft] = useState(initial);
  const [creating, setCreating] = useState(false);
  const set = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }));

  const options = useSubCategoryOptions(reference, initial.subCategoryId ?? undefined);
  const parsed = ruleInputSchema.safeParse(input(draft));
  const touched =
    parsed.success && sample
      ? sample.lines.filter((line) => {
          const target: RuleTarget = {
            currency: sample.currency,
            amount: parseAmount(line.amount, sample.currency).minor,
            counterparty: line.counterparty,
            label: line.label,
            memo: line.memo,
            bankCategory: line.bankCategory,
          };
          return ruleMatches(parsed.data, target);
        }).length
      : null;

  return (
    <Modal opened onClose={onClose} title={t("statements.rules.form")} size="lg">
      <Stack>
        <TextInput
          label={t("statements.rules.name")}
          placeholder={draft.text || draft.bankCategory}
          maxLength={100}
          value={draft.name}
          onChange={(e) => set({ name: e.currentTarget.value })}
        />
        <Text fw={600} size="sm">
          {t("statements.rules.conditions")}
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput
            label={t("statements.rules.text")}
            maxLength={100}
            value={draft.text}
            onChange={(e) => set({ text: e.currentTarget.value })}
            data-autofocus
          />
          <TextInput
            label={t("statements.rules.bankCategory")}
            maxLength={100}
            value={draft.bankCategory}
            onChange={(e) => set({ bankCategory: e.currentTarget.value })}
          />
          <Select
            label={t("statements.rules.direction")}
            allowDeselect={false}
            data={[
              { value: "any", label: t("statements.rules.any") },
              { value: "in", label: t("statements.rules.in") },
              { value: "out", label: t("statements.rules.out") },
            ]}
            value={draft.direction}
            onChange={(value) => set({ direction: (value as Draft["direction"]) ?? "any" })}
          />
          <TextInput
            label={t("statements.rules.min")}
            inputMode="decimal"
            value={draft.minAmount}
            onChange={(e) => set({ minAmount: e.currentTarget.value })}
          />
          <TextInput
            label={t("statements.rules.max")}
            inputMode="decimal"
            value={draft.maxAmount}
            onChange={(e) => set({ maxAmount: e.currentTarget.value })}
          />
        </SimpleGrid>
        <Text fw={600} size="sm">
          {t("statements.rules.actions")}
        </Text>
        <Checkbox
          label={t("statements.rules.ignore")}
          checked={draft.ignore}
          onChange={(e) => set({ ignore: e.currentTarget.checked })}
        />
        {!draft.ignore && (
          <WithCreate label={t("reference.newSubCategory")} onCreate={() => setCreating(true)}>
            <Select
              label={t("statements.review.subCategory")}
              searchable
              clearable
              data={options}
              value={draft.subCategoryId}
              onChange={(value) => set({ subCategoryId: value })}
            />
          </WithCreate>
        )}
        <TextInput
          label={t("statements.review.description")}
          maxLength={500}
          value={draft.description}
          onChange={(e) => set({ description: e.currentTarget.value })}
        />
        {touched !== null && (
          <Text size="sm" c="dimmed">
            {t("statements.rules.touches", { count: touched })}
          </Text>
        )}
        {!parsed.success && (
          <Text size="sm" c="orange">
            {parsed.error.issues[0]?.message}
          </Text>
        )}
        <ErrorAlert error={save.error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!parsed.success}
            loading={save.isPending}
            onClick={() =>
              save.mutate(
                { id: ruleId, rule: input(draft) },
                {
                  onSuccess: () => {
                    onSaved?.();
                    onClose();
                  },
                },
              )
            }
          >
            {t("common.save")}
          </Button>
        </Group>
      </Stack>
      {creating && (
        <QuickCreate
          kind="subCategory"
          bookId={bookId}
          initialName={sample?.suggestedName}
          onClose={() => setCreating(false)}
          onCreated={(id) => set({ subCategoryId: id })}
        />
      )}
    </Modal>
  );
}

/** The rules of the book, in the order they are tried. */
export function RulesPanel({ bookId }: { bookId: string }) {
  const { t } = useTranslation();
  const reference = useReference(bookId);
  const nameOf = useNameOf(reference.data?.defaultLanguage);
  const rules = useRules(bookId);
  const remove = useDeleteRule(bookId);
  const order = useOrderRules(bookId);
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);

  const list = rules.data ?? [];
  const subName = (id: string) =>
    nameOf(reference.data?.subCategories.find((s) => s.id === id)?.names ?? {});

  const conditions = (rule: Rule) =>
    [
      rule.text && t("statements.rules.contains", { text: rule.text }),
      rule.bankCategory && t("statements.rules.bankIs", { text: rule.bankCategory }),
      rule.direction !== "any" && t(`statements.rules.${rule.direction}`),
      rule.minAmount && t("statements.rules.atLeast", { amount: rule.minAmount }),
      rule.maxAmount && t("statements.rules.atMost", { amount: rule.maxAmount }),
    ]
      .filter(Boolean)
      .join(" · ");
  const actions = (rule: Rule) =>
    [
      rule.ignore && t("statements.rules.ignoreLine"),
      rule.subCategoryId && subName(rule.subCategoryId),
      rule.description && `« ${rule.description} »`,
    ]
      .filter(Boolean)
      .join(" · ");

  const move = (index: number, by: -1 | 1) => {
    const ids = list.map((r) => r.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + by, 0, moved!);
    order.mutate(ids);
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={4}>{t("statements.rules.title")}</Title>
        <Button size="compact-md" variant="light" onClick={() => setEditing({ draft: blank })}>
          {t("statements.rules.new")}
        </Button>
      </Group>
      <Text size="sm" c="dimmed">
        {t("statements.rules.intro")}
      </Text>
      <ErrorAlert error={rules.error ?? remove.error ?? order.error} />
      {list.length > 0 && (
        <DataTable minWidth={620} highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={70} />
              <Table.Th>{t("statements.rules.name")}</Table.Th>
              <Table.Th>{t("statements.rules.conditions")}</Table.Th>
              <Table.Th>{t("statements.rules.actions")}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.map((rule, index) => (
              <Table.Tr key={rule.id}>
                <Table.Td>
                  <Group gap={2} wrap="nowrap">
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      disabled={index === 0 || order.isPending}
                      aria-label={t("statements.rules.up")}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      disabled={index === list.length - 1 || order.isPending}
                      aria-label={t("statements.rules.down")}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </ActionIcon>
                  </Group>
                </Table.Td>
                <Table.Td>{rule.name}</Table.Td>
                <Table.Td>
                  <Text size="sm">{conditions(rule)}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{actions(rule)}</Text>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Button
                      size="compact-sm"
                      variant="light"
                      onClick={() => setEditing({ id: rule.id, draft: draftOf(rule) })}
                    >
                      {t("statements.rules.edit")}
                    </Button>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={t("common.delete")}
                      onClick={() => {
                        if (
                          window.confirm(t("statements.rules.deleteConfirm", { name: rule.name }))
                        ) {
                          remove.mutate(rule.id);
                        }
                      }}
                    >
                      ✕
                    </ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </DataTable>
      )}
      {editing && (
        <RuleForm
          bookId={bookId}
          ruleId={editing.id}
          initial={editing.draft}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}
