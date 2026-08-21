(function migrationReviewModule(root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) module.exports = exported;
  if (root && root.document) root.TV_TRACKER_MIGRATION_REVIEW_MODEL = exported;
})(typeof globalThis === "object" ? globalThis : this, function createModule() {
  "use strict";

  const STATUS_TO_DATABASE = Object.freeze({
    "Not Started": "not_started", Watching: "watching", Completed: "completed",
    "Purchase Only": "purchase_only", "Region Blocked": "region_blocked"
  });
  const ACTION_LABELS = Object.freeze({
    keep_cloud_record: "Keep cloud show",
    apply_local_record: "Use device show details",
    create_local_record: "Add device show to cloud",
    delete_cloud_record: "Delete cloud show",
    keep_cloud_season: "Keep cloud season",
    apply_local_season: "Use device season status",
    create_local_season: "Add device season to cloud",
    delete_cloud_season: "Delete cloud season"
  });

  function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
  function cloudShowIdentity(show) { return `show:${String(show.id).toLowerCase()}`; }
  function localShowIdentity(show) { return `legacy:${show.legacyId}`; }
  function seasonIdentity(parent, number) { return `${parent}/season:${number}`; }

  function cloudTrackerPayload(shows) {
    if (!Array.isArray(shows)) throw new TypeError("Cloud shows are required");
    return Object.freeze({
      schemaVersion: 2,
      shows: Object.freeze(shows.map((show) => Object.freeze({
        identity: show.legacyId ? `legacy:${show.legacyId}` : `cloud:${String(show.id).toLowerCase()}`,
        legacyId: show.legacyId == null ? null : show.legacyId,
        platform: show.platform,
        title: show.title,
        firstAirDate: show.firstAirDate == null ? null : show.firstAirDate,
        synopsis: show.description,
        posterUrl: show.posterUrl == null ? null : show.posterUrl,
        tmdbId: show.tmdb && show.tmdb.id != null ? show.tmdb.id : null,
        tmdbPosterPath: show.tmdb && show.tmdb.posterPath != null ? show.tmdb.posterPath : null,
        createdAt: show.createdAt,
        updatedAt: show.updatedAt,
        seasons: Object.freeze(show.seasons.map((season) => {
          const status = STATUS_TO_DATABASE[season.status];
          if (!status) throw new TypeError("Unknown cloud season status");
          return Object.freeze({ number: season.number, status });
        }))
      })))
    });
  }

  function showComparable(show) {
    return JSON.stringify([show.platform, show.title, show.firstAirDate, show.synopsis, show.posterUrl,
      show.tmdbId, show.tmdbPosterPath, show.createdAt, show.updatedAt]);
  }

  function item({ id, entityType, kind, sourceIdentity, cloudIdentity, label, actions, expectedRevision, parentId = null }) {
    return Object.freeze({ id, entityType, kind, sourceIdentity, cloudIdentity, label, actions: Object.freeze(actions), expectedRevision, parentId });
  }

  function buildMigrationDiff(sourcePayload, cloudShows) {
    if (!sourcePayload || !Array.isArray(sourcePayload.shows) || !Array.isArray(cloudShows)) throw new TypeError("Tracker snapshots are required");
    const localByLegacy = new Map(sourcePayload.shows.map((show) => [show.legacyId, show]));
    const cloudByLegacy = new Map(cloudShows.filter((show) => show.legacyId).map((show) => [show.legacyId, show]));
    const pairs = [];
    for (const local of sourcePayload.shows) pairs.push({ local, cloud: cloudByLegacy.get(local.legacyId) || null });
    for (const cloud of cloudShows) if (!cloud.legacyId || !localByLegacy.has(cloud.legacyId)) pairs.push({ local: null, cloud });
    pairs.sort((left, right) => compareText(
      left.local ? localShowIdentity(left.local) : cloudShowIdentity(left.cloud),
      right.local ? localShowIdentity(right.local) : cloudShowIdentity(right.cloud)
    ));

    const items = [];
    for (const pair of pairs) {
      const sourceId = pair.local ? localShowIdentity(pair.local) : null;
      const cloudId = pair.cloud ? cloudShowIdentity(pair.cloud) : null;
      const parentId = `show|${sourceId || ""}|${cloudId || ""}`;
      if (!pair.cloud) {
        items.push(item({ id: parentId, entityType: "show", kind: "local_only", sourceIdentity: sourceId, cloudIdentity: null,
          label: pair.local.title, actions: ["create_local_record"], expectedRevision: null }));
      } else if (!pair.local) {
        items.push(item({ id: parentId, entityType: "show", kind: "cloud_only", sourceIdentity: null, cloudIdentity: cloudId,
          label: pair.cloud.title, actions: ["keep_cloud_record", "delete_cloud_record"], expectedRevision: pair.cloud.revision }));
      } else {
        const cloudCanonical = cloudTrackerPayload([pair.cloud]).shows[0];
        if (showComparable(pair.local) !== showComparable(cloudCanonical)) {
          items.push(item({ id: parentId, entityType: "show", kind: "changed", sourceIdentity: sourceId, cloudIdentity: cloudId,
            label: pair.local.title, actions: ["keep_cloud_record", "apply_local_record"], expectedRevision: pair.cloud.revision }));
        }
      }

      const localSeasons = new Map((pair.local ? pair.local.seasons : []).map((season) => [season.number, season]));
      const cloudSeasons = new Map((pair.cloud ? pair.cloud.seasons : []).map((season) => [season.number, season]));
      const numbers = [...new Set([...localSeasons.keys(), ...cloudSeasons.keys()])].sort((a, b) => a - b);
      for (const number of numbers) {
        const localSeason = localSeasons.get(number) || null;
        const cloudSeason = cloudSeasons.get(number) || null;
        const localSeasonId = sourceId && localSeason ? seasonIdentity(sourceId, number) : null;
        const cloudSeasonId = cloudId && cloudSeason ? seasonIdentity(cloudId, number) : null;
        const id = `season|${localSeasonId || ""}|${cloudSeasonId || ""}`;
        if (!cloudSeason) {
          items.push(item({ id, entityType: "season", kind: "local_only", sourceIdentity: localSeasonId, cloudIdentity: null,
            label: `${pair.local.title} — Season ${number}`, actions: ["create_local_season"], expectedRevision: null, parentId }));
        } else if (!localSeason) {
          items.push(item({ id, entityType: "season", kind: "cloud_only", sourceIdentity: null, cloudIdentity: cloudSeasonId,
            label: `${pair.cloud.title} — Season ${number}`, actions: ["keep_cloud_season", "delete_cloud_season"], expectedRevision: cloudSeason.revision, parentId }));
        } else if (localSeason.status !== STATUS_TO_DATABASE[cloudSeason.status]) {
          items.push(item({ id, entityType: "season", kind: "changed", sourceIdentity: localSeasonId, cloudIdentity: cloudSeasonId,
            label: `${pair.local.title} — Season ${number}`, actions: ["keep_cloud_season", "apply_local_season"], expectedRevision: cloudSeason.revision, parentId }));
        }
      }
    }
    return Object.freeze(items);
  }

  function decisionsFromSelections(items, selections = {}) {
    const byId = new Map(items.map((entry) => [entry.id, entry]));
    const chosen = [];
    for (const entry of items) {
      const action = selections[entry.id];
      if (!action) continue;
      if (!entry.actions.includes(action)) throw new TypeError("Unsupported review action");
      const parent = entry.parentId ? byId.get(entry.parentId) : null;
      const parentAction = parent && selections[parent.id];
      if (entry.entityType === "season" && parentAction === "delete_cloud_record") throw new TypeError("Parent deletion conflicts with a child decision");
      if (entry.entityType === "season" && action === "create_local_season" && parent && parent.kind === "local_only" && parentAction !== "create_local_record") {
        throw new TypeError("The parent show must be selected for creation");
      }
      const mutatesCloud = action.startsWith("apply_") || action.startsWith("delete_");
      chosen.push(Object.freeze({
        entityType: entry.entityType,
        sourceIdentity: entry.sourceIdentity,
        cloudIdentity: entry.cloudIdentity,
        action,
        expectedRevision: mutatesCloud ? entry.expectedRevision : null
      }));
    }
    return Object.freeze({ decisions: Object.freeze(chosen) });
  }

  return Object.freeze({ ACTION_LABELS, STATUS_TO_DATABASE, buildMigrationDiff, cloudTrackerPayload, decisionsFromSelections });
});
