/**
 * The wizard's suggested index name, distinct per account.
 *
 * A vector index name is not private to the account that picks it: on
 * pgvector one name is one physical table for the whole deployment, so two
 * users who both accept a fixed default write into the same table, separated
 * only by the namespace column. The default therefore carries who it belongs
 * to — the email local part for a human to recognise, plus a slice of the
 * user id so two accounts sharing a local part across domains still differ.
 *
 * The field stays editable; this only decides what it starts as.
 */

/** Suffix the backend pairs with a dense index for its BM25 sibling. */
// Mirrors `BM25_INDEX_SUFFIX` in app/pipelines/nodes/indexing.py — the sibling
// has to fit the same length rule, so the default reserves room for it.
const BM25_SUFFIX = "-bm25";

const PREFIX = "ragworks";

/** Characters of the user id kept as the distinguishing suffix. */
const ID_SLICE = 8;

export interface IndexNameOwner {
  id: string;
  email: string;
}

/**
 * Build the default index name for one account.
 *
 * `maxLength` is the backend's own `index_name_max_length` capability — never
 * a constant repeated here, because a backend's limits are declared once on
 * the backend. The result always matches the strict index-name rule
 * (`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`) and leaves room for the BM25 sibling.
 */
export function defaultIndexName(owner: IndexNameOwner, maxLength: number): string {
  const suffix = slugify(owner.id).replace(/-/g, "").slice(0, ID_SLICE);
  const budget = maxLength - BM25_SUFFIX.length;
  const tail = suffix ? `-${suffix}` : "";
  const slugBudget = budget - PREFIX.length - tail.length - 1;
  // Re-trimmed after the cut: truncating mid-word can land on a hyphen, and
  // joining that to the id suffix would read as a doubled separator.
  const slug =
    slugBudget > 0 ? trimSeparators(slugify(localPart(owner.email)).slice(0, slugBudget)) : "";
  const name = [PREFIX, slug, suffix].filter(Boolean).join("-");
  return trimSeparators(name.slice(0, budget)) || PREFIX;
}

/** The part of an email before `@`, which is the human-recognisable half. */
function localPart(email: string): string {
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

/** Reduce arbitrary text to the index-name alphabet. */
function slugify(value: string): string {
  return trimSeparators(value.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
}

/** Drop leading and trailing hyphens, which the name rule forbids. */
function trimSeparators(value: string): string {
  return value.replace(/^-+|-+$/g, "");
}
