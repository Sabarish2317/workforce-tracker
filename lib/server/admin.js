import 'server-only';
import { findUserById } from './db';
import { HttpError, idParam, validate } from './http';

/** Resolves the [id] route param to a worker; admin accounts aren't browsable as workers. */
export const loadWorker = async (context) => {
  const { id } = validate(idParam, await context.params);
  const worker = await findUserById(id);
  if (!worker || worker.role !== 'worker') throw new HttpError(404, 'Worker not found');
  return worker;
};
