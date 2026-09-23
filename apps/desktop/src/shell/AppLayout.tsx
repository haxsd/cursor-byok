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
import { TooltipTrigger } from "../shared/ui/TooltipTrigger";
import { navCallsIcon, navDevinIcon, navModelsIcon, navOverviewIcon, navPluginsIcon, navSettingsIcon, navTutorialIcon } from "../shared/ui/navIcons";
import { refreshIcon } from "../shared/ui/icons";
import { useMessage } from "../shared/ui/message";
import { appStore, useAppStore } from "../shared/store/appStore";
import styles from "./AppLayout.module.scss";
import { PageActionsTarget } from "./PageActions";

type MenuItem =
  | { kind: "page"; path: string; label: string; icon: IconifyIcon | string }
  | { kind: "external"; id: string; label: string; icon: IconifyIcon | string }
  | { kind: "group"; label: string };

const keptAlivePages = ["/", "/calls", "/models", "/settings", "/harness/cursor", "/harness/devin", "/plugins"];
const tutorialReadStorageKey = "haxsd-byok:tutorial-read";
const tutorialUrl = "https://docs.leokun.cn";

export function AppLayout() {
  const { busy, cursorHarness, devinStatus } = useAppStore();
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
        active: cursorHarness.settings_applied,
      };
    }
    if (path === "/harness/devin" && devinStatus) {
      return {
        label: devinStatus.listening ? t("运行中") : devinStatus.enabled ? t("待重启") : t("未启用"),
        active: devinStatus.enabled && devinStatus.listening,
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
      .catch((cause) => message(cause instanceof Error ? cause.message : String(cause)));
  }, [message]);

  const renderIcon = (icon: IconifyIcon | string) => typeof icon === "string"
    ? <Icon src={icon} size="1.15em" />
    : <Icon icon={icon} size="1.15em" />;

  return <PageLayout className={styles.root}>
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
                return <span className={styles.navStatus} data-active={status.active || undefined}>{status.label}</span>;
              })()}
            </NavLink>)}
      </nav>
      {/* Page actions share the title's band rather than the navigation bar: a page
          with a wide filter (the overview's time range) would otherwise squeeze the
          bar until items were clipped on a narrow window. */}
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
        <KeepAliveRouteOutlet
          activeCacheKey={location.pathname}
          include={keptAlivePages}
          max={keptAlivePages.length}
          enableActivity
          containerClassName={styles.keepAliveContainer}
          cacheNodeClassName={styles.keepAlivePage}
        />
      </PageActionsTarget.Provider>
    </main>
  </PageLayout>;
}
