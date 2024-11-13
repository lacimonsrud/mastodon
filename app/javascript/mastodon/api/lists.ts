import { apiRequestPost, apiRequestPut } from 'mastodon/api';
import type { ApiListJSON } from 'mastodon/api_types/lists';

export const apiCreate = (list: Partial<ApiListJSON>) =>
  apiRequestPost<ApiListJSON>('v1/lists', list);

export const apiUpdate = (list: Partial<ApiListJSON>) =>
  apiRequestPut<ApiListJSON>(`v1/lists/${list.id}`, list);
