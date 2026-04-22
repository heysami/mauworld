import test from "node:test";
import assert from "node:assert/strict";
import {
  installPublicLibraryStore,
  resolvePublicLibraryResourceKind,
  serializePublicLibrarySnapshotResource,
} from "../src/lib/public-library-store.js";

class FakeStore {}

installPublicLibraryStore(FakeStore);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeQuery {
  constructor(state, table) {
    this.state = state;
    this.table = table;
    this.filters = [];
    this.orders = [];
    this.rowLimit = null;
    this.mutationRows = null;
  }

  _source() {
    return this.state[this.table] ?? [];
  }

  _matches(row) {
    return this.filters.every((matcher) => matcher(row));
  }

  _rows() {
    let rows = this._source().filter((row) => this._matches(row)).map((row) => clone(row));
    for (const order of this.orders) {
      rows = rows.sort((left, right) => {
        if (left?.[order.column] === right?.[order.column]) {
          return 0;
        }
        return left?.[order.column] > right?.[order.column] ? 1 : -1;
      });
      if (!order.ascending) {
        rows.reverse();
      }
    }
    if (Number.isFinite(this.rowLimit)) {
      rows = rows.slice(0, this.rowLimit);
    }
    return rows;
  }

  select() {
    return this;
  }

  eq(column, value) {
    this.filters.push((row) => row?.[column] === value);
    return this;
  }

  in(column, values = []) {
    const allowed = new Set(values);
    this.filters.push((row) => allowed.has(row?.[column]));
    return this;
  }

  order(column, { ascending = true } = {}) {
    this.orders.push({ column, ascending });
    return this;
  }

  limit(count) {
    const numeric = Number(count);
    this.rowLimit = Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
    return this;
  }

  insert(payload) {
    const rows = Array.isArray(payload) ? payload : [payload];
    const inserted = rows.map((row, index) => ({
      id: row.id ?? `${this.table}_${this._source().length + index + 1}`,
      ...clone(row),
    }));
    this.state[this.table].push(...inserted.map((row) => clone(row)));
    this.mutationRows = inserted;
    return this;
  }

  update(patch) {
    const updated = [];
    for (const row of this._source()) {
      if (!this._matches(row)) {
        continue;
      }
      Object.assign(row, clone(patch));
      updated.push(clone(row));
    }
    this.mutationRows = updated;
    return this;
  }

  delete() {
    const removed = [];
    const kept = [];
    for (const row of this._source()) {
      if (this._matches(row)) {
        removed.push(clone(row));
      } else {
        kept.push(row);
      }
    }
    this.state[this.table] = kept;
    this.mutationRows = removed;
    return this;
  }

  maybeSingle() {
    const rows = this.mutationRows ?? this._rows();
    if (!rows.length) {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST116" },
      });
    }
    return Promise.resolve({
      data: clone(rows[0]),
      error: null,
    });
  }

  single() {
    const rows = this.mutationRows ?? this._rows();
    if (!rows.length) {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST116" },
      });
    }
    return Promise.resolve({
      data: clone(rows[0]),
      error: null,
    });
  }

  then(resolve, reject) {
    const rows = this.mutationRows ?? this._rows();
    return Promise.resolve({
      data: clone(rows),
      error: null,
    }).then(resolve, reject);
  }
}

function createReviewStore() {
  const state = {
    public_library_listings: [{
      id: "listing_123",
      owner_profile_id: "profile_owner",
      state: "active",
      kind: "resource",
      resource_kind: "texture",
      title: "Lantern Pack",
      rating_average: 0,
      review_count: 0,
    }],
    public_library_listing_reviews: [],
    public_library_profile_reviews: [],
    user_profiles: [
      {
        id: "profile_owner",
        username: "maker",
        display_name: "Maker",
      },
      {
        id: "profile_reviewer",
        username: "reviewer",
        display_name: "Reviewer",
      },
    ],
  };
  const store = new FakeStore();
  store.serviceClient = {
    from(table) {
      return new FakeQuery(state, table);
    },
  };
  store.config = {
    mediaBucket: "mauworld-media",
  };
  store.getPublicLibraryListing = async ({ listingId }, profile) => {
    const listing = state.public_library_listings.find((entry) => entry.id === listingId);
    const viewerReview = state.public_library_listing_reviews.find((entry) =>
      entry.listing_id === listingId && entry.reviewer_profile_id === profile?.id);
    return {
      listing: {
        id: listing.id,
        rating_average: listing.rating_average,
        review_count: listing.review_count,
        viewer_review: viewerReview ? clone(viewerReview) : null,
      },
    };
  };
  store.getPublicLibraryProfile = async ({ username }, profile) => {
    const reviewedProfile = state.user_profiles.find((entry) => entry.username === username);
    const viewerReview = state.public_library_profile_reviews.find((entry) =>
      entry.reviewed_profile_id === reviewedProfile?.id && entry.reviewer_profile_id === profile?.id);
    return {
      profile: {
        username,
      },
      viewer_review: viewerReview ? clone(viewerReview) : null,
      reviews: state.public_library_profile_reviews
        .filter((entry) => entry.reviewed_profile_id === reviewedProfile?.id)
        .map((entry) => clone(entry)),
    };
  };
  return { store, state };
}

test("resolvePublicLibraryResourceKind enforces source compatibility rules", () => {
  assert.equal(resolvePublicLibraryResourceKind({
    asset_type: "texture",
    context: {},
  }), "texture");
  assert.equal(resolvePublicLibraryResourceKind({
    asset_type: "texture",
    context: { media_kind: "video_texture" },
  }), "video");
  assert.equal(resolvePublicLibraryResourceKind({
    asset_type: "sound",
  }), "sound");
  assert.equal(resolvePublicLibraryResourceKind({
    asset_type: "model",
  }), "model");
  assert.equal(resolvePublicLibraryResourceKind({
    asset_type: "model",
  }, "animation"), "animation");
  assert.throws(
    () => resolvePublicLibraryResourceKind({
      asset_type: "sound",
    }, "texture"),
    /can only be published as a sound resource/,
  );
  assert.throws(
    () => resolvePublicLibraryResourceKind({
      asset_type: "model",
    }, "video"),
    /Models can only be published as 3D models or animation resources/,
  );
});

test("serializePublicLibrarySnapshotResource preserves resource metadata without mutating it", () => {
  const asset = {
    id: "asset_123",
    asset_type: "model",
    name: "Lantern Rig",
    provider: "openai",
    intended_use: "ambient prop",
    world_context_summary: "Hanging lantern with idle sway",
    source_world_id: "mw_world",
    source_world_name: "Lantern Hall",
    context: {
      media_kind: "mesh",
    },
    spec: {
      version: 1,
    },
    provider_metadata: {
      prompt: "lantern rig",
    },
    bounds: {
      radius: 2,
    },
    files: [{
      role: "model",
      filename: "lantern.glb",
      content_type: "model/gltf-binary",
      size_bytes: 1024,
    }],
  };

  const snapshot = serializePublicLibrarySnapshotResource(asset, "animation");

  assert.equal(snapshot.id, "asset_123");
  assert.equal(snapshot.resource_kind, "animation");
  assert.equal(snapshot.source_world_name, "Lantern Hall");
  assert.deepEqual(snapshot.context, { media_kind: "mesh" });
  assert.equal(snapshot.files[0].filename, "lantern.glb");

  snapshot.context.media_kind = "changed";
  assert.equal(asset.context.media_kind, "mesh");
});

test("listing reviews require comments, block self-reviews, and recompute aggregates", async () => {
  const { store, state } = createReviewStore();

  await assert.rejects(
    () => store.upsertPublicLibraryListingReview({
      id: "profile_reviewer",
      username: "reviewer",
    }, {
      listingId: "listing_123",
      rating: 5,
      comment: "   ",
    }),
    /Invalid comment/,
  );

  await assert.rejects(
    () => store.upsertPublicLibraryListingReview({
      id: "profile_owner",
      username: "maker",
    }, {
      listingId: "listing_123",
      rating: 5,
      comment: "I love my own work",
    }),
    /cannot review your own listing/i,
  );

  const created = await store.upsertPublicLibraryListingReview({
    id: "profile_reviewer",
    username: "reviewer",
  }, {
    listingId: "listing_123",
    rating: 5,
    comment: "Well packed and easy to use.",
  });

  assert.equal(state.public_library_listing_reviews.length, 1);
  assert.equal(state.public_library_listing_reviews[0].rating, 5);
  assert.equal(state.public_library_listings[0].rating_average, 5);
  assert.equal(state.public_library_listings[0].review_count, 1);
  assert.equal(created.listing.viewer_review.comment, "Well packed and easy to use.");

  const updated = await store.upsertPublicLibraryListingReview({
    id: "profile_reviewer",
    username: "reviewer",
  }, {
    listingId: "listing_123",
    rating: 3,
    comment: "Updated after a closer look.",
  });

  assert.equal(state.public_library_listing_reviews.length, 1);
  assert.equal(state.public_library_listing_reviews[0].rating, 3);
  assert.equal(state.public_library_listing_reviews[0].comment, "Updated after a closer look.");
  assert.equal(state.public_library_listings[0].rating_average, 3);
  assert.equal(state.public_library_listings[0].review_count, 1);
  assert.equal(updated.listing.viewer_review.rating, 3);
});

test("creator reviews require comments, block self-reviews, and upsert one review per reviewer", async () => {
  const { store, state } = createReviewStore();

  await assert.rejects(
    () => store.upsertPublicLibraryProfileReview({
      id: "profile_reviewer",
      username: "reviewer",
    }, {
      username: "maker",
      rating: 4,
      comment: "",
    }),
    /Invalid comment/,
  );

  await assert.rejects(
    () => store.upsertPublicLibraryProfileReview({
      id: "profile_owner",
      username: "maker",
    }, {
      username: "maker",
      rating: 5,
      comment: "Very reliable.",
    }),
    /cannot review your own profile/i,
  );

  const created = await store.upsertPublicLibraryProfileReview({
    id: "profile_reviewer",
    username: "reviewer",
  }, {
    username: "maker",
    rating: 4,
    comment: "Fast replies and clear handoff notes.",
  });

  assert.equal(state.public_library_profile_reviews.length, 1);
  assert.equal(state.public_library_profile_reviews[0].rating, 4);
  assert.equal(created.viewer_review.comment, "Fast replies and clear handoff notes.");

  const updated = await store.upsertPublicLibraryProfileReview({
    id: "profile_reviewer",
    username: "reviewer",
  }, {
    username: "maker",
    rating: 2,
    comment: "Updating after a slower second exchange.",
  });

  assert.equal(state.public_library_profile_reviews.length, 1);
  assert.equal(state.public_library_profile_reviews[0].rating, 2);
  assert.equal(state.public_library_profile_reviews[0].comment, "Updating after a slower second exchange.");
  assert.equal(updated.viewer_review.rating, 2);
});
