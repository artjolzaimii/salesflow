"use client";

import { NAV_GROUPS, type SectionKey } from "@/lib/navigation";
import { useActions, usePreview } from "@/store/preview-store";
import { useRole } from "@/store/hooks";
import { Icon } from "@/components/ui/icon";
import { useGo } from "./use-go";

/*
 * Responsive behaviour (prototype breakpoints):
 * - below 900px the sidebar is an off-canvas drawer opened from the top bar;
 * - from 900px it is sticky and can collapse to a 64px icon rail.
 * `nav:` is the ≥900px breakpoint; `group-data-[collapsed=true]/side` reads the
 * collapsed flag so labels hide only on wide screens.
 */
const label = "nav:group-data-[collapsed=true]/side:hidden";
const centerWhenCollapsed = "nav:group-data-[collapsed=true]/side:justify-center";

export function Sidebar({ section }: { section: SectionKey }) {
  const role = useRole();
  const collapsed = usePreview((s) => s.sidebarCollapsed);
  const mobileOpen = usePreview((s) => s.mobileNavOpen);
  const actions = useActions();
  const go = useGo();

  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => role.nav.includes(it.key)) })).filter((g) => g.items.length);

  return (
    <aside
      aria-label="Main navigation"
      data-collapsed={collapsed}
      className={`group/side top-0 left-0 z-50 h-screen flex-none flex-col overflow-y-auto border-r border-divider bg-bg max-nav:fixed max-nav:w-[264px] nav:sticky nav:flex nav:w-[236px] nav:data-[collapsed=true]:w-16 ${
        mobileOpen ? "flex" : "hidden"
      }`}
    >
      <div className={`flex h-14 flex-none items-center gap-[10px] border-b border-divider px-4 ${centerWhenCollapsed}`}>
        <div className="grid h-7 w-7 flex-none place-items-center border border-accent font-heading text-[13px] font-semibold text-accent-800">SF</div>
        <div className={`flex flex-col leading-[1.1] ${label}`}>
          <span className="font-heading text-[18px] font-semibold">SalesFlow</span>
          <span className="text-[11px] text-neutral-700">Wholesale · Albania</span>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-[14px] px-[10px] py-[14px]">
        {groups.map((g) => (
          <div key={g.label} className="flex flex-col gap-[2px]">
            <div className={`px-[10px] pb-1 text-[10.5px] tracking-[0.1em] text-neutral-700 uppercase ${label}`}>{g.label}</div>
            {g.items.map((it) => {
              const active = section === it.key;
              return (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => go.section(it.key)}
                  title={collapsed ? it.label : undefined}
                  aria-label={it.label}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-[34px] w-full cursor-pointer items-center gap-[10px] border-0 border-l-2 px-[10px] py-[6px] text-left text-[14px] hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] ${centerWhenCollapsed} ${
                    active ? "border-accent bg-accent-100 font-medium text-accent-800" : "border-transparent bg-transparent font-normal text-text"
                  }`}
                >
                  <Icon name={it.icon} />
                  <span className={label}>{it.label}</span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-2 border-t border-divider p-[10px]">
        <button
          type="button"
          className={`btn btn-ghost font-body font-normal text-neutral-700 max-nav:hidden ${centerWhenCollapsed} justify-start`}
          onClick={actions.toggleSidebar}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <Icon name="panel" />
          <span className={label}>Collapse</span>
        </button>
      </div>
    </aside>
  );
}
