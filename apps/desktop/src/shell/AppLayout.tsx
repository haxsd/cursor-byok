import { useCallback, useState } from "react";
import type { IconifyIcon } from "@iconify/react/offline";
import KeepAliveRouteOutlet from "keepalive-for-react-router";
import { NavLink, useLocation } from "react-router-dom";
import cursorIconUrl from "../shared/assets/icons/cursor.svg";
import { api } from "../shared/api";
import { PageLayout } from "./layout/PageLayout";
import { ConfirmDialog } from "../shared/ui/ConfirmDialog";
import controls from "../shared/ui/Controls.module.scss";
import { Icon } from "../shared/ui/Icon";
import { StatusPill } from "../shared/ui/StatusPill";
import { TooltipTrigger } from "../shared/ui/TooltipTrigger";
import { navCallsIcon, navDevinIcon, navModelsIcon, navOverviewIcon, navPluginsIcon, navSettingsIcon, navTutorialIcon } from "../shared/ui/navIcons";
import { refreshIcon, searchIcon } from "../shared/ui/icons";
import { useMessage } from "../shared/ui/message";
import { appStore, useAppStore } from "../shared/store/appStore";
import styles from "./AppLayout.module.scss";
import { CommandPalette } from "./CommandPalette";
import { OfflineBanner } from "./OfflineBanner";
import { PageActionsTarget } from "./PageActions";
import { PageErrorBoundary } from "./PageErrorBoundary";

type MenuItem =
  | { kind: "page"; path: string; label: string; icon: IconifyIcon | string }
  | { kind: "external"; id: string; label: string; icon: IconifyIcon | string }
  | { kind: "group"; label: string };

const keptAlivePages = ["/", "/calls", "/models", "/settings", "/harness/cursor", "/harness/devin", "/plugins"];
const tutorialReadStorageKey = "haxsd-byok:tutorial-read";
const tutorialUrl = "https://docs.leokun.cn";

export function AppLayout() {
  const { busy, cursorHarness, devinStatus, overview, models, offline } = useAppStore();
  const message = useMessage();
  const location = useLocation();
  const [leftActionTarget, setLeftActionTarget] = useState<HTMLDivElement | null>(null);
  const [rightActionTarget, setRightActionTarget] = useState<HTMLDivElement | null>(null);
  const [confirmTutorial, setConfirmTutorial] = useState(false);
  const [tutorialRead, setTutorialRead] = useState(() => {
    try {
      return localStorage.getItem(tutorialReadStorageKey) === "true";
    } catch {
      return false;
    }
  });

  // Both harnesses report the same kind of state, so Cursor and Devin read as
  // parallel modules rather than one annotated and one bare. Both values come from
  // the shared store refresh, so there is one source of truth.
  const menuStatus = (path: string) => {
    if (path === "/harness/cursor" && cursorHarness) {
      return {
        label: cursorHarness.settings_applied ? t("已接管") : t("未接管"),
        tone: cursorHarness.settings_applied ? "ok" as const : "idle" as const,
      };
    }
    if (path === "/harness/devin" && devinStatus) {
      return {
        label: devinStatus.listening ? t("运行中") : devinStatus.enabled ? t("待重启") : t("未启用"),
        tone: devinStatus.enabled && devinStatus.listening ? "ok" as const : devinStatus.enabled ? "warn" as const : "idle" as const,
      };
    }
    return null;
  };

  // Groups stay in the list as separators: a horizontal bar has no room for the
  // section headings a vertical list used to carry.
  const menuItems: MenuItem[] = [
    { kind: "page", path: "/", label: t("概览"), icon: navOverviewIcon },
    { kind: "page", path: "/calls", label: t("调用"), icon: navCallsIcon },
    { kind: "group", label: t("接入模块") },
    { kind: "page", path: "/harness/cursor", label: "Cursor", icon: cursorIconUrl },
    { kind: "page", path: "/harness/devin", label: "Devin", icon: navDevinIcon },
    { kind: "group", label: t("共享") },
    { kind: "page", path: "/models", label: t("模型"), icon: navModelsIcon },
    { kind: "group", label: t("设置") },
    { kind: "page", path: "/plugins", label: t("插件配置"), icon: navPluginsIcon },
    { kind: "page", path: "/settings", label: t("系统设置"), icon: navSettingsIcon },
    { kind: "external", id: "tutorial", label: t("使用教程"), icon: navTutorialIcon },
  ];

  const openTutorial = useCallback(() => {
    setConfirmTutorial(false);
    void api.openExternalUrl(tutorialUrl)
      .then(() => {
        setTutorialRead(true);
        try {
          localStorage.setItem(tutorialReadStorageKey, "true");
        } catch {
          // Read state remains valid for the current session when storage is unavailable.
        }
      })
      .catch((cause) => message.error(cause));
  }, [message]);

  const renderIcon = (icon: IconifyIcon | string) => typeof icon === "string"
    ? <Icon src={icon} size="1.15em" />
    : <Icon icon={icon} size="1.15em" />;

  return <PageLayout className={styles.root}>
    <CommandPalette />
    <OfflineBanner />
    <div className={styles.topBar}>
      <nav className={styles.navigation} aria-label={t("主菜单")}>
        {menuItems.map((item) => item.kind === "group"
          ? <span key={`group-${item.label}`} className={styles.navDivider} aria-hidden="true" />
          : item.kind === "external"
            ? <button
              key={`external-${item.id}`}
              type="button"
              className={styles.navItem}
              aria-label={`${item.label}${tutorialRead ? "" : `，${t("未读")}`}`}
              onClick={() => setConfirmTutorial(true)}
            >
              {renderIcon(item.icon)}
              <span>{item.label}</span>
              {!tutorialRead && <span className={styles.navDot} aria-hidden="true" />}
            </button>
            : <NavLink key={item.path} to={item.path} end={item.path === "/"} className={styles.navItem}>
              {renderIcon(item.icon)}
              <span>{item.label}</span>
              {(() => {
                const status = menuStatus(item.path);
                if (!status) return null;
                return <span className={styles.navStatus} data-tone={status.tone}>{status.label}</span>;
              })()}
            </NavLink>)}
      </nav>
      {/* The state of the machine, on every page. It replaced a per-page hunt: the
          gateway's health, how much has been called and how many models exist were
          each only visible on one page, so "is it working" had no single answer. */}
      <div className={styles.systemStatus} aria-label={t("运行状态")}>
        <TooltipTrigger label={t("本机网关")}>
          <StatusPill
            tone={offline ? "bad" : devinStatus?.listening ? "ok" : devinStatus?.enabled ? "warn" : "idle"}
            title={t("本机网关")}
          >{offline
            ? t("服务未连接")
            : devinStatus?.listening ? t("运行中") : devinStatus?.enabled ? t("待重启") : t("已关闭")}</StatusPill>
        </TooltipTrigger>
        <span className={styles.statusDivider} aria-hidden="true" />
        <TooltipTrigger label={t("调用记录中已统计的调用次数")}>
          <span className={styles.statusFact}><strong>{overview.metrics.llm_calls}</strong>{t("次调用")}</span>
        </TooltipTrigger>
        <span className={styles.statusDivider} aria-hidden="true" />
        <TooltipTrigger label={t("模型库里可用的模型")}>
          <span className={styles.statusFact}><strong>{models.length}</strong>{t("个模型")}</span>
        </TooltipTrigger>
        <span className={styles.statusDivider} aria-hidden="true" />
        {/* A keyboard shortcut nobody can see is a shortcut nobody uses. */}
        <TooltipTrigger label={t("搜索或执行命令")}>
          <button
            type="button"
            className={styles.commandButton}
            aria-label={t("搜索或执行命令")}
            onClick={() => window.dispatchEvent(new Event("byok:open-command-palette"))}
          >
            <Icon icon={searchIcon} size="1em" />
            <kbd>Ctrl K</kbd>
          </button>
        </TooltipTrigger>
      </div>
    </div>
    <div className={styles.actionRegion}>
      <div ref={setLeftActionTarget} className={styles.pageActions} />
      {location.pathname !== "/" && <TooltipTrigger label={t("刷新")}><button className={controls.iconButton} aria-label={t("刷新")} disabled={busy} onClick={() => void appStore.refresh()}>
        <Icon className={busy ? controls.spin : ""} icon={refreshIcon} size="1.1em" />
      </button></TooltipTrigger>}
      <div ref={setRightActionTarget} className={styles.pageActions} />
    </div>
    <ConfirmDialog
      id="open-tutorial-dialog"
      open={confirmTutorial}
      title={t("打开使用教程？")}
      cancelLabel={t("取消")}
      confirmLabel={t("打开教程")}
      onCancel={() => setConfirmTutorial(false)}
      onConfirm={openTutorial}
    >
      <p>{t("将在系统浏览器中打开使用教程，是否继续？")}</p>
    </ConfirmDialog>
    <main className={styles.content}>
      <PageActionsTarget.Provider value={{ left: leftActionTarget, right: rightActionTarget }}>
        <PageErrorBoundary resetKey={location.pathname}>
          <KeepAliveRouteOutlet
            activeCacheKey={location.pathname}
            include={keptAlivePages}
            max={keptAlivePages.length}
            enableActivity
            containerClassName={styles.keepAliveContainer}
            cacheNodeClassName={styles.keepAlivePage}
          />
        </PageErrorBoundary>
      </PageActionsTarget.Provider>
    </main>
  </PageLayout>;
}
