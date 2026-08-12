export type JsonPrimitive =
  | string
  | number
  | boolean
  | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };

export type AuditOperation =
  | "CREATE"
  | "UPDATE"
  | "DELETE";

export type AuditFieldChange = {
  old: JsonValue;
  new: JsonValue;
};

export type AuditEvent = {
  id: string;
  eventGroupId: string;
  createdAt: string;
  actorUsername: string;
  actorFullName: string;
  actorRole: string;
  companyName: string;
  baseId: string;
  tableName: string;
  recordId: string;
  recordLabel: string;
  module: string;
  action: string;
  operation: AuditOperation;
  oldData: JsonValue;
  newData: JsonValue;
  changedFields: Record<
    string,
    AuditFieldChange
  >;
  sourceHost: string;
  metadata: Record<
    string,
    JsonValue
  >;
};

export type AuditQuery = {
  user?: string;
  module?: string;
  action?: string;
  company?: string;
  table?: string;
  record?: string;
  recordIds?: string[];
  baseId?: string;
  operation?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
};
