# ADR-004: AWS SAM para empaquetar Lambdas


**Estado**: Aceptado · **Fecha**: 2026-06-30

### Contexto

Hay que definir cómo declarar y desplegar las Lambdas. Las opciones principales son SAM, CDK, Terraform, Serverless Framework.

### Opciones consideradas

| Opción | Pros | Contras |
|---|---|---|
| **SAM** | AWS-native, `sam local`, simple para Lambdas | Sintaxis YAML declarativa, no programática |
| CDK | Type-safe, programático | Paradigma diferente a Terraform ya usado |
| Terraform | Consistencia con 02-infrastructure | Sin `sam local`, packaging manual |
| Serverless Framework | Multi-cloud | Vendor extra, menos idiomático |

### Decisión

**SAM** para definir todas las Lambdas + API Gateway. **Terraform** se mantiene para infra persistente (VPC, RDS, S3, IAM, Cognito, Secrets Manager, SSM Parameters).

### Consecuencias

**Positivas**:
- `sam local invoke` y `sam local start-api` para testing sin AWS
- Definiciones concisas (`AWS::Serverless::Function` resuelve role, log group, tracing automáticamente)
- Capas (Layers) declarativas

**Negativas**:
- Dos herramientas (SAM + Terraform)
- SAM no soporta rollback nativo en deploy

**Mitigaciones**:
- Contrato claro: Terraform = infra persistente, SAM = código serverless
- Deploy de Terraform PRIMERO, luego SAM (lee SSM outputs)

---

