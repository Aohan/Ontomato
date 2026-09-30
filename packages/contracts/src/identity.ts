export interface RequestIdentity {
  userId: string;
  loginCode?: string;
  userName: string;
  roles: string[];
  domainId?: string;
  domainName?: string;
}
