/**
 * Identity and node-type constants shared by more than one fixture module.
 *
 * They live apart from the builders that use them because the pipeline
 * builders and the trace builders both need them: defining them beside either
 * one would make the two modules import each other.
 */

export const USER_ID = "user-1";
export const USER_EMAIL = "user@example.com";

export const RETRIEVER_TYPE = "retriever.vector";
export const RETRIEVER_LABEL = "Retriever";
