// =============================================================================
// SSM config path builder - ADR-0002 cross-repo contract
// =============================================================================
// 02-infrastructure (Terraform, modules/ssm-bootstrap) publishes every
// runtime configuration parameter under:
//
//   /spark-match/{environment}/config/{key}
//
// (docs/adr/0002-cross-repo-config-contract-ssm-secrets.md in that repo).
// The environment segment comes from the ENVIRONMENT variable that both
// SAM templates inject into every function. The 'dev' fallback only
// applies to local runs and unit tests, where no real SSM call is made.
// =============================================================================

export function ssmConfigPath(key: string): string {
  const environment = process.env.ENVIRONMENT ?? 'dev';
  return `/spark-match/${environment}/config/${key}`;
}
