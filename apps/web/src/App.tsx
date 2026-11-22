import { Alert, Container, Group, Loader, Select, Stack, Text, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "./api";
import { languages, type Language } from "./i18n";

function Health() {
  const { t } = useTranslation();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const response = await api.health.$get();
      return response.ok;
    },
  });

  if (health.isPending) {
    return (
      <Group>
        <Loader size="sm" />
        <Text>{t("health.checking")}</Text>
      </Group>
    );
  }
  return health.data ? (
    <Alert color="green" title={t("health.title")}>
      {t("health.ok")}
    </Alert>
  ) : (
    <Alert color="red" title={t("health.title")}>
      {t("health.error")}
    </Alert>
  );
}

export function App() {
  const { t, i18n } = useTranslation();
  return (
    <Container size="sm" py="xl">
      <Stack>
        <Group justify="space-between">
          <Title>{t("app.title")}</Title>
          <Select
            aria-label={t("language")}
            w={140}
            value={i18n.language}
            onChange={(value) => value && void i18n.changeLanguage(value as Language)}
            data={Object.entries(languages).map(([value, label]) => ({ value, label }))}
          />
        </Group>
        <Text c="dimmed">{t("app.tagline")}</Text>
        <Health />
      </Stack>
    </Container>
  );
}
