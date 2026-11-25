import { Anchor, Stack, Text, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";

const REPOSITORY = "https://github.com/RemiLequette/cash-scout";

export function About() {
  const { t } = useTranslation();
  return (
    <Stack gap="xs">
      <img src="/icon-192.png" alt="" width={96} height={96} style={{ borderRadius: 20 }} />
      <Title order={3}>{t("app.title")}</Title>
      <Text>{t("app.tagline")}</Text>
      <Text>{t("about.version", { version: __APP_VERSION__ })}</Text>
      <Text c="dimmed" size="sm">
        {t("about.license")}
      </Text>
      <Anchor href={REPOSITORY} target="_blank" rel="noreferrer" size="sm">
        {t("about.source")}
      </Anchor>
    </Stack>
  );
}
