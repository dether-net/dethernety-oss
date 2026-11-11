resource "aws_kms_key" "orders_db" {
  description         = "Orders database storage"
  enable_key_rotation = true
}

resource "aws_db_subnet_group" "private" {
  name       = "orders-db-private"
  subnet_ids = var.private_db_subnet_ids
}

resource "aws_security_group" "orders_db" {
  name   = "orders-db"
  vpc_id = var.vpc_id

  ingress {
    description = "orders namespace workloads"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.20.16.0/20"]
  }

  ingress {
    description = "operations access"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.20.9.0/28"]
  }
}

resource "aws_db_parameter_group" "orders" {
  name   = "orders-pg16"
  family = "postgres16"

  parameter {
    name  = "rds.force_ssl"
    value = "0"
  }

  parameter {
    name  = "ssl_min_protocol_version"
    value = "TLSv1.2"
  }

  parameter {
    name  = "password_encryption"
    value = "scram-sha-256"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name         = "shared_preload_libraries"
    value        = "pgaudit"
    apply_method = "pending-reboot"
  }

  parameter {
    name  = "pgaudit.log"
    value = "ddl,role,write"
  }
}

resource "aws_db_instance" "orders" {
  identifier                          = "orders-db"
  engine                              = "postgres"
  engine_version                      = "16"
  instance_class                      = "db.r6g.large"
  allocated_storage                   = 100
  db_name                             = "orders"
  username                            = "orders_master"
  manage_master_user_password         = true
  iam_database_authentication_enabled = false
  storage_encrypted                   = true
  kms_key_id                          = aws_kms_key.orders_db.arn
  publicly_accessible                 = false
  db_subnet_group_name                = aws_db_subnet_group.private.name
  vpc_security_group_ids              = [aws_security_group.orders_db.id]
  parameter_group_name                = aws_db_parameter_group.orders.name
  backup_retention_period             = 14
  auto_minor_version_upgrade          = true
  deletion_protection                 = true
  enabled_cloudwatch_logs_exports     = ["postgresql"]
}

resource "aws_cloudwatch_log_group" "orders_db" {
  name              = "/aws/rds/instance/orders-db/postgresql"
  retention_in_days = 30
}

variable "vpc_id" {
  type = string
}

variable "private_db_subnet_ids" {
  type = list(string)
}
