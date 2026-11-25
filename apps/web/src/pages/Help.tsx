import { Anchor, Box, Group, NavLink, Stack, Table, Text, Title } from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslation } from "react-i18next";
import { helpTopics } from "../help";

/** In-help links are relative file links (`04-journal.md`), so that they also work in Obsidian and on GitHub. */
function HelpLink({ href, children }: { href?: string; children?: ReactNode }) {
  const navigate = useNavigate();
  const topic = /^(?:\d+-)?([\w-]+)\.md$/.exec(href ?? "")?.[1];
  if (topic) {
    return (
      <Anchor
        href={`/help/${topic}`}
        onClick={(event) => {
          event.preventDefault();
          void navigate({ to: "/help/$topic", params: { topic } });
        }}
      >
        {children}
      </Anchor>
    );
  }
  return (
    <Anchor href={href} target="_blank" rel="noreferrer">
      {children}
    </Anchor>
  );
}

const components: Components = {
  h1: ({ children }) => (
    <Title order={2} mb="sm">
      {children}
    </Title>
  ),
  h2: ({ children }) => (
    <Title order={4} mt="lg" mb="xs">
      {children}
    </Title>
  ),
  p: ({ children }) => <Text mb="sm">{children}</Text>,
  ul: ({ children }) => (
    <Box component="ul" mb="sm" pl="lg">
      {children}
    </Box>
  ),
  ol: ({ children }) => (
    <Box component="ol" mb="sm" pl="lg">
      {children}
    </Box>
  ),
  li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
  a: ({ href, children }) => <HelpLink href={href}>{children}</HelpLink>,
  table: ({ children }) => (
    <Table.ScrollContainer minWidth={400} mb="sm">
      <Table withTableBorder withColumnBorders verticalSpacing="xs">
        {children}
      </Table>
    </Table.ScrollContainer>
  ),
  thead: ({ children }) => <Table.Thead>{children}</Table.Thead>,
  tbody: ({ children }) => <Table.Tbody>{children}</Table.Tbody>,
  tr: ({ children }) => <Table.Tr>{children}</Table.Tr>,
  th: ({ children }) => <Table.Th>{children}</Table.Th>,
  td: ({ children }) => <Table.Td>{children}</Table.Td>,
};

export function Help({ topic }: { topic?: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const topics = helpTopics(i18n.language);
  const current = topics.find((item) => item.slug === topic) ?? topics[0];
  return (
    <Group align="flex-start" wrap="wrap" gap="xl">
      <Stack gap={0} w={220} aria-label={t("help.topics")} component="nav">
        {topics.map((item) => (
          <NavLink
            key={item.slug}
            label={item.title}
            active={item.slug === current?.slug}
            onClick={() => void navigate({ to: "/help/$topic", params: { topic: item.slug } })}
          />
        ))}
      </Stack>
      <Box style={{ flex: 1, minWidth: 280, maxWidth: 780 }}>
        {current ? (
          <Markdown remarkPlugins={[remarkGfm]} components={components}>
            {current.body}
          </Markdown>
        ) : null}
      </Box>
    </Group>
  );
}
