"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Brand } from "./brand";
import { DashboardMotion } from "./dashboard-motion";
import {
  AdminIcon,
  CloseIcon,
  ExtensionsIcon,
  MenuIcon,
  OverviewIcon,
  PhrasesIcon,
  PreferencesIcon,
  PrivacyIcon,
  SearchIcon,
  SignOutIcon,
  VocabularyIcon,
} from "./icons";
import { PendingForm } from "./pending";
import { DashboardProviders } from "./providers";

interface NavItem {
  href: string;
  icon: ComponentType<{ size?: number }>;
  label: string;
}

const OVERVIEW_NAV: NavItem = { href: "/overview", icon: OverviewIcon, label: "Overview" };

const LIBRARY_NAV: NavItem[] = [
  { href: "/phrases", icon: PhrasesIcon, label: "Saved phrases" },
  { href: "/vocabulary", icon: VocabularyIcon, label: "My vocabulary" },
];

const ACCOUNT_NAV: NavItem[] = [
  { href: "/preferences", icon: PreferencesIcon, label: "Preferences" },
  { href: "/extensions", icon: ExtensionsIcon, label: "Connected extensions" },
  { href: "/privacy", icon: PrivacyIcon, label: "Privacy and data" },
];

const PRIMARY_NAV: NavItem[] = [OVERVIEW_NAV, ...LIBRARY_NAV, ...ACCOUNT_NAV];

const ADMIN_NAV: NavItem = { href: "/admin", icon: AdminIcon, label: "Operations" };

export interface ShellUser {
  displayName: string | null;
  email: string | null;
  isAdmin: boolean;
  pictureUrl: string | null;
}

function initials(user: ShellUser): string {
  const source = user.displayName || user.email || "?";
  return source
    .split(/[\s@._-]+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

function Navigation({ isAdmin, onNavigate }: { isAdmin: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const renderLink = (item: NavItem) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const IconComponent = item.icon;
    return (
      <Link
        aria-current={active ? "page" : undefined}
        className="nav__link"
        href={item.href}
        key={item.href}
        onClick={onNavigate}
      >
        <IconComponent size={16} />
        {item.label}
      </Link>
    );
  };
  return (
    <nav aria-label="Dashboard" className="nav">
      {renderLink(OVERVIEW_NAV)}
      <p className="nav__section">Library</p>
      {LIBRARY_NAV.map(renderLink)}
      <p className="nav__section">Account</p>
      {ACCOUNT_NAV.map(renderLink)}
      {isAdmin ? (
        <>
          <p className="nav__section">Administration</p>
          {renderLink(ADMIN_NAV)}
        </>
      ) : null}
    </nav>
  );
}

/**
 * The account photo from the identity provider, falling back to initials when there is none or it
 * fails to load. Unoptimized keeps the photo off the image optimizer, so only the browser fetches it.
 */
function AccountAvatar({ user }: { user: ShellUser }) {
  const [pictureFailed, setPictureFailed] = useState(false);
  return (
    <span aria-hidden="true" className="account__avatar">
      {user.pictureUrl && !pictureFailed ? (
        <Image
          alt=""
          className="account__picture"
          height={32}
          onError={() => setPictureFailed(true)}
          referrerPolicy="no-referrer"
          src={user.pictureUrl}
          unoptimized
          width={32}
        />
      ) : (
        initials(user)
      )}
    </span>
  );
}

function AccountFooter({ csrfToken, user }: { csrfToken: string; user: ShellUser }) {
  return (
    <div className="account">
      <AccountAvatar user={user} />
      <span className="account__text">
        <span className="account__name">{user.displayName || "Signed in"}</span>
        {user.email ? <span className="account__email">{user.email}</span> : null}
      </span>
      <PendingForm action="/auth/sign-out" method="post">
        <input name="csrf" type="hidden" value={csrfToken} />
        <button
          aria-label="Sign out"
          className="button button--ghost button--small button--icon"
          title="Sign out"
          type="submit"
        >
          <SignOutIcon size={16} />
        </button>
      </PendingForm>
    </div>
  );
}

interface PaletteCommand {
  group: string;
  id: string;
  keywords: string;
  label: string;
  run: () => void;
}

function CommandPalette({
  commands,
  onClose,
  open,
}: {
  commands: PaletteCommand[];
  onClose: () => void;
  open: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.keywords}`.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      setQuery("");
      setActive(0);
      element.showModal();
      input.current?.focus();
    } else if (!open && element.open) {
      element.close();
      returnFocus.current?.focus();
    }
  }, [open]);

  const runCommand = (command: PaletteCommand | undefined) => {
    if (!command) return;
    onClose();
    command.run();
  };

  let lastGroup = "";
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape closes the native dialog
    <dialog
      aria-label="Command menu"
      className="palette"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      ref={dialog}
    >
      <input
        aria-activedescendant={results[active] ? `command-${results[active].id}` : undefined}
        aria-controls="command-list"
        aria-expanded="true"
        aria-label="Search commands"
        autoComplete="off"
        className="palette__input"
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(results.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            runCommand(results[active]);
          }
        }}
        placeholder="Go to a page or run an action…"
        ref={input}
        role="combobox"
        value={query}
      />
      {results.length === 0 ? (
        <p className="palette__empty">No command matches “{query}”.</p>
      ) : (
        <div className="palette__list" id="command-list" role="listbox">
          {results.map((command, index) => {
            const heading = command.group !== lastGroup ? command.group : null;
            lastGroup = command.group;
            return (
              <div key={command.id} role="presentation">
                {heading ? (
                  <p aria-hidden="true" className="palette__group">
                    {heading}
                  </p>
                ) : null}
                <div
                  aria-selected={index === active}
                  className="palette__item"
                  id={`command-${command.id}`}
                  onClick={() => runCommand(command)}
                  onKeyDown={() => undefined}
                  onMouseMove={() => setActive(index)}
                  role="option"
                  tabIndex={-1}
                >
                  {command.label}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </dialog>
  );
}

export function AppShell({
  children,
  csrfToken,
  user,
}: {
  children: ReactNode;
  csrfToken: string;
  user: ShellUser;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const drawer = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = useCallback(() => {
    drawer.current?.showModal();
    setDrawerOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    if (drawer.current?.open) {
      drawer.current.close();
      menuButton.current?.focus();
    }
  }, []);

  // A modal dialog traps focus but not scrolling, so the page behind is locked while it is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [drawerOpen]);

  // Navigating from inside the drawer closes it.
  const shownPath = useRef(pathname);
  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    closeDrawer();
  }, [pathname, closeDrawer]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands = useMemo<PaletteCommand[]>(() => {
    const navigate = [...PRIMARY_NAV, ...(user.isAdmin ? [ADMIN_NAV] : [])].map((item) => ({
      group: "Go to",
      id: item.href.slice(1),
      keywords: item.href,
      label: item.label,
      run: () => router.push(item.href),
    }));
    return [
      ...navigate,
      {
        group: "Actions",
        id: "export-phrases",
        keywords: "download excel spreadsheet xlsx backup",
        label: "Export saved phrases (Excel)",
        run: () => {
          window.location.href = "/api/dashboard/export?scope=phrases";
        },
      },
      {
        group: "Actions",
        id: "export-vocabulary",
        keywords: "download excel spreadsheet xlsx words",
        label: "Export vocabulary (Excel)",
        run: () => {
          window.location.href = "/api/dashboard/export?scope=vocabulary";
        },
      },
      {
        group: "Actions",
        id: "export-account",
        keywords: "download data privacy",
        label: "Download account data",
        run: () => {
          window.location.href = "/api/dashboard/export?scope=account";
        },
      },
      {
        group: "Actions",
        id: "revoke",
        keywords: "disconnect sessions extension",
        label: "Manage connected extensions",
        run: () => router.push("/extensions"),
      },
    ];
  }, [router, user.isAdmin]);

  const searchTrigger = (
    <button className="search-trigger" onClick={() => setPaletteOpen(true)} type="button">
      <SearchIcon size={14} />
      <span>Search</span>
      <span aria-hidden="true" className="kbd">
        ⌘K
      </span>
    </button>
  );

  return (
    <DashboardProviders csrfToken={csrfToken}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar__brand">
            <Brand href="/overview" />
          </div>
          {searchTrigger}
          <Navigation isAdmin={user.isAdmin} />
          <div className="sidebar__footer">
            <AccountFooter csrfToken={csrfToken} user={user} />
          </div>
        </aside>

        <header className="topbar">
          <button
            aria-controls="navigation-drawer"
            aria-expanded={drawerOpen}
            aria-label="Open navigation"
            className="button button--ghost button--icon topbar__menu"
            onClick={openDrawer}
            ref={menuButton}
            type="button"
          >
            <MenuIcon size={18} />
          </button>
          <Brand href="/overview" />
          <div className="page-header__actions topbar__actions">
            <button
              aria-label="Search"
              className="button button--ghost button--icon"
              onClick={() => setPaletteOpen(true)}
              type="button"
            >
              <SearchIcon size={18} />
            </button>
          </div>
        </header>

        {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape closes the native dialog */}
        <dialog
          aria-label="Navigation"
          className="drawer"
          id="navigation-drawer"
          onCancel={(event) => {
            event.preventDefault();
            closeDrawer();
          }}
          onClose={() => setDrawerOpen(false)}
          onClick={(event) => {
            if (event.target === drawer.current) closeDrawer();
          }}
          ref={drawer}
        >
          <div className="drawer__inner">
            <div className="sidebar__brand">
              <Brand />
              <button
                aria-label="Close navigation"
                className="button button--ghost button--icon"
                onClick={closeDrawer}
                type="button"
              >
                <CloseIcon size={18} />
              </button>
            </div>
            <Navigation isAdmin={user.isAdmin} onNavigate={closeDrawer} />
            <div className="sidebar__footer">
              <AccountFooter csrfToken={csrfToken} user={user} />
            </div>
          </div>
        </dialog>

        <main className="main" id="main" tabIndex={-1}>
          <DashboardMotion key={pathname}>{children}</DashboardMotion>
        </main>
      </div>
      <CommandPalette
        commands={commands}
        onClose={() => setPaletteOpen(false)}
        open={paletteOpen}
      />
    </DashboardProviders>
  );
}
