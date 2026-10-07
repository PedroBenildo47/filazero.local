CREATE TYPE "OrganizationDocumentType" AS ENUM (
    'COMPANY_REGISTRATION',
    'TAX_REGISTRATION',
    'BANKING_LICENSE',
    'REGULATOR_AUTHORIZATION'
);

CREATE TABLE "organization_documents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "type" "OrganizationDocumentType" NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "organization_documents_size_bytes_check" CHECK ("size_bytes" > 0)
);

CREATE UNIQUE INDEX "organization_documents_organization_id_type_key"
    ON "organization_documents"("organization_id", "type");
CREATE INDEX "organization_documents_organization_id_created_at_idx"
    ON "organization_documents"("organization_id", "created_at");

ALTER TABLE "organization_documents"
    ADD CONSTRAINT "organization_documents_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
