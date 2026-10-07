import { searchResponseSchema, type SearchResolver } from "./contract";

export const SEARCH_NOT_CONNECTED = "Search is not connected yet";

/** G-2. Empty on purpose. Does not rank, index, or invent a hit. */
export const stubSearchResolver: SearchResolver = async (query) =>
  searchResponseSchema.parse({
    connected: false,
    query,
    results: [],
    notice: SEARCH_NOT_CONNECTED,
  });
