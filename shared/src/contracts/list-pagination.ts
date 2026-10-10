/** List filters are applied before paging; multi-select values are comma-separated. */
export interface CampaignListQuery {
  sort?: string;
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  type?: string;
}

export interface WorkflowListQuery {
  sort?: string;
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  trigger?: string;
  isActive?: boolean;
  archived?: boolean;
}
