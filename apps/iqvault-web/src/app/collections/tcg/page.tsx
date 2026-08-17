import { redirect } from "next/navigation";

/** Old generic TCG tab — the live Pokémon collection is /collections/pokemon. */
export default function TcgCollectionRedirect() {
  redirect("/collections/pokemon");
}
