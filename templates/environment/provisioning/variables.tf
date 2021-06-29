## These variables are set in the ./deployment/scripts/provision script with env values
## from ./deployment/environments/<environment>/.env

variable "project" {
  default = "tectonic"
}

variable "environment" {
  default = "staging"
}

variable "region" {
  default = "us-east1"
}

variable "zone" {
  default = "c"
}

variable "bucket_prefix" {
  default = "tectonic_staging"
}

variable "cluster_name" {
  default = "cluster-1"
}

variable "node_pool_count" {
  default = 3
}

variable "min_node_count" {
  default = 3
}

variable "max_node_count" {
  default = 6
}

variable "preemptible" {
  default = false
}

variable "machine_type" {
  default = "c2-standard-8"
}