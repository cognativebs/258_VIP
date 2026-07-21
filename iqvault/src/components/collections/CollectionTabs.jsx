import { COLLECTION_GROUPS, COLLECTION_TABS } from "../../data/collections.js";

export default function CollectionTabs({ activeId, onChange }) {
  return (
    <nav className="bb-collections-bar" aria-label="Collection verticals">
      {COLLECTION_GROUPS.map((group) => {
        const tabs = COLLECTION_TABS.filter((t) => t.group === group.id);
        return (
          <div key={group.id} className="bb-collections-group">
            <span className="bb-collections-group-label">{group.label}</span>
            <div className="bb-collections-tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`bb-collection-tab ${activeId === tab.id ? "active" : ""} ${tab.status === "live" ? "live" : ""}`}
                  onClick={() => onChange(tab.id)}
                  title={tab.label}
                >
                  <span className="bb-collection-tab-icon">{tab.icon}</span>
                  <span className="bb-collection-tab-label">{tab.shortLabel}</span>
                  {tab.status === "live" && <span className="bb-collection-tab-badge">LIVE</span>}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
