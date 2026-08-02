import type { FiscalParameterSnapshot, FiscalParameterType, LoginTicket } from './types.js';

const REQUIRED_PARAMETER_TYPES: readonly FiscalParameterType[] = Object.freeze([
  'document_types',
  'recipient_document_types',
  'vat_types',
  'currencies',
  'concepts',
  'points_of_sale',
]);

export async function syncOfficialParameterTables({
  login,
  getParameters,
  save,
}: {
  login: () => Promise<LoginTicket>;
  getParameters: (ticket: LoginTicket, type: FiscalParameterType) => Promise<FiscalParameterSnapshot>;
  save: (snapshot: FiscalParameterSnapshot) => Promise<void>;
}): Promise<ReadonlyArray<FiscalParameterSnapshot>> {
  const ticket = await login();
  const snapshots: FiscalParameterSnapshot[] = [];
  for (const parameterType of REQUIRED_PARAMETER_TYPES) {
    const snapshot = await getParameters(ticket, parameterType);
    await save(snapshot);
    snapshots.push(snapshot);
  }
  return Object.freeze(snapshots);
}

export { REQUIRED_PARAMETER_TYPES };
