import {
  Alert,
  AppShell,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Modal,
  Select,
  Text,
  Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { api } from "./api";
import { authClient, useSession } from "./auth";
import { languages, type Language } from "./i18n";
import { Admin } from "./pages/Admin";
import { Book } from "./pages/Book";
import { Books } from "./pages/Books";
import { ChangePassword } from "./pages/Password";
import { SignIn } from "./pages/SignIn";

function LanguageSelect() {
  const { t, i18n } = useTranslation();
  return (
    <Select
      aria-label={t("language")}
      w={130}
      value={i18n.language}
      allowDeselect={false}
      onChange={(value) => value && void i18n.changeLanguage(value as Language)}
      data={Object.entries(languages).map(([value, label]) => ({ value, label }))}
    />
  );
}

/** Shown only when the API cannot reach the database. */
function HealthAlert() {
  const { t } = useTranslation();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => (await api.health.$get()).ok,
    refetchInterval: 60_000,
  });
  return health.data === false ? (
    <Alert color="red" title={t("health.title")} mb="md">
      {t("health.error")}
    </Alert>
  ) : null;
}

function Layout() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: session, isPending } = useSession();
  const [changingPassword, setChangingPassword] = useState(false);

  if (isPending) {
    return (
      <Center mih="100vh">
        <Loader />
      </Center>
    );
  }

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
  }

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Container size="lg" h="100%">
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="lg" wrap="nowrap">
              <Title order={3}>{t("app.title")}</Title>
              {session && <Link to="/">{t("nav.books")}</Link>}
              {session?.user.role === "admin" && <Link to="/admin">{t("nav.admin")}</Link>}
            </Group>
            <Group wrap="nowrap">
              <LanguageSelect />
              {session && (
                <>
                  <Button
                    variant="subtle"
                    size="xs"
                    visibleFrom="sm"
                    title={t("password.change")}
                    onClick={() => setChangingPassword(true)}
                  >
                    {session.user.name}
                  </Button>
                  <Button variant="default" size="xs" onClick={signOut}>
                    {t("nav.signOut")}
                  </Button>
                </>
              )}
            </Group>
          </Group>
        </Container>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="lg">
          <HealthAlert />
          {session ? <Outlet /> : <SignIn />}
        </Container>
      </AppShell.Main>
      <Modal
        opened={changingPassword}
        onClose={() => setChangingPassword(false)}
        title={t("password.change")}
      >
        <ChangePassword onClose={() => setChangingPassword(false)} />
      </Modal>
    </AppShell>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return <Text c="dimmed">{t("notFound")}</Text>;
}

const rootRoute = createRootRoute({ component: Layout, notFoundComponent: NotFound });

const booksRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Books });

const bookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/books/$bookId",
  component: function BookPage() {
    const { bookId } = bookRoute.useParams();
    return <Book key={bookId} bookId={bookId} />;
  },
});

const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  component: Admin,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([booksRoute, bookRoute, adminRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
