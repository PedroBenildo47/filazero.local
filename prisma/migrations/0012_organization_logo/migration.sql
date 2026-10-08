-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "logo_updated_at" TIMESTAMPTZ(6),
ADD COLUMN     "logo_url" VARCHAR(500);

-- CreateTable
CREATE TABLE "organization_logos" (
    "organization_id" UUID NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organization_logos_pkey" PRIMARY KEY ("organization_id")
);

-- AddForeignKey
ALTER TABLE "organization_logos" ADD CONSTRAINT "organization_logos_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
