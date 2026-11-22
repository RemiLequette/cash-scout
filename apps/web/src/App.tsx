import {
  Alert,
  AppShell,
  Burger,
  Center,
  Container,
  Group,
  Loader,
  Menu,
  Modal,
  Select,
  Text,
  Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { api } from "./api";
import { authClient, useSession } from "./auth";
import { languages, type Language } from "./i18n";
import { Admin } from "./pages/Admin";
import { Book, useBook, type BookView } from "./pages/Book";
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

/** The book open in the page, if any, and the part of it shown. */
function useOpenBook(): { bookId?: string; view: BookView } {
  const { bookId } = useParams({ strict: false });
  const { view } = useSearch({ strict: false });
  return { bookId, view: view ?? "journal" };
}

/** The name of the open book and of the part shown, next to the app title. */
function BookTitle({ bookId, view }: { bookId: string; view: BookView }) {
  const { t } = useTranslation();
  const book = useBook(bookId);
  if (!book.data) return null;
  return (
    <Text fw={600} truncate>
      {book.data.name}
      {view !== "journal" && (
        <Text span c="dimmed" fw={400}>
          {" · "}
          {t(view === "reference" ? "book.referenceData" : "book.settingsAndMembers")}
        </Text>
      )}
    </Text>
  );
}

/** All navigation in one menu: the open book, the books, the language and the account. */
function NavMenu({
  onChangePassword,
  onSignOut,
}: {
  onChangePassword: () => void;
  onSignOut: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { bookId, view } = useOpenBook();
  const book = useBook(bookId);
  const [opened, setOpened] = useState(false);
  const mark = (on: boolean) => (
    <span style={{ display: "inline-block", width: 14 }}>{on ? "✓" : ""}</span>
  );
  const open = (next: BookView) =>
    void navigate({
      to: "/books/$bookId",
      params: { bookId: bookId! },
      search: next === "journal" ? {} : { view: next },
    });
  return (
    <Menu opened={opened} onChange={setOpened} position="bottom-start" width={260} withinPortal>
      <Menu.Target>
        <Burger opened={opened} size="sm" aria-label={t("nav.menu")} />
      </Menu.Target>
      <Menu.Dropdown>
        {bookId && book.data && (
          <>
            <Menu.Label>
              {book.data.name} · {book.data.currency} · {t(`roles.${book.data.role}`)}
            </Menu.Label>
            <Menu.Item leftSection={mark(view === "journal")} onClick={() => open("journal")}>
              {t("book.journal")}
            </Menu.Item>
            <Menu.Item leftSection={mark(view === "reference")} onClick={() => open("reference")}>
              {t("book.referenceData")}
            </Menu.Item>
            <Menu.Item leftSection={mark(view === "settings")} onClick={() => open("settings")}>
              {t("book.settingsAndMembers")}
            </Menu.Item>
            <Menu.Divider />
          </>
        )}
        <Menu.Item leftSection={mark(false)} onClick={() => void navigate({ to: "/" })}>
          {t("nav.books")}
        </Menu.Item>
        {session?.user.role === "admin" && (
          <Menu.Item leftSection={mark(false)} onClick={() => void navigate({ to: "/admin" })}>
            {t("nav.admin")}
          </Menu.Item>
        )}
        <Menu.Divider />
        <Menu.Label>{t("language")}</Menu.Label>
        {Object.entries(languages).map(([value, label]) => (
          <Menu.Item
            key={value}
            leftSection={mark(i18n.language === value)}
            onClick={() => void i18n.changeLanguage(value as Language)}
          >
            {label}
          </Menu.Item>
        ))}
        <Menu.Divider />
        {session && <Menu.Label>{session.user.name}</Menu.Label>}
        <Menu.Item leftSection={mark(false)} onClick={onChangePassword}>
          {t("password.change")}
        </Menu.Item>
        <Menu.Item leftSection={mark(false)} color="red" onClick={onSignOut}>
          {t("nav.signOut")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
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
  const { bookId, view } = useOpenBook();

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
    <AppShell header={{ height: 48 }} padding="sm">
      <AppShell.Header>
        <Container size="lg" h="100%">
          <Group h="100%" justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap" miw={0}>
              {session && (
                <NavMenu
                  onChangePassword={() => setChangingPassword(true)}
                  onSignOut={() => void signOut()}
                />
              )}
              <Title order={4} style={{ flexShrink: 0 }}>
                {t("app.title")}
              </Title>
              {session && bookId && <BookTitle bookId={bookId} view={view} />}
            </Group>
            {!session && <LanguageSelect />}
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
  validateSearch: (search: Record<string, unknown>): { view?: Exclude<BookView, "journal"> } =>
    search.view === "reference" || search.view === "settings" ? { view: search.view } : {},
  component: function BookPage() {
    const { bookId } = bookRoute.useParams();
    const { view } = bookRoute.useSearch();
    return <Book key={bookId} bookId={bookId} view={view ?? "journal"} />;
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
