locals {
  global = {
    project          = var.project,
    region           = var.region,
    multi_region     = "US",
    zone             = var.zone,
    environment      = var.environment,
    location         = "${var.region}-${var.zone}",
    bucket_prefix    = var.bucket_prefix,
    cluster_name     = var.cluster_name,
    node_pool_count  = var.node_pool_count,
    min_node_count   = var.min_node_count,
    max_node_count   = var.max_node_count,
    machine_type     = var.machine_type,
    preemptible      = var.preemptible
  }
}

module "gke-cluster" {
  source = "../../../provisioning/gke-cluster-module"

  global = local.global
}

module "gcp-buckets" {
  source = "../../../provisioning/gcp-bucket-module"

  global = local.global
}

resource "google_compute_disk" "tectonic_mongo_disk" {
  project = var.project
  name    = "tectonic-mongo-disk"
  type    = "pd-ssd"
  zone    = local.global.location
  size    = 300
  labels  = {
    "goog-gke-volume" = ""
  }
}

resource "google_compute_disk" "tectonic_elasticsearch_disk" {
  project = var.project
  name    = "tectonic-elasticsearch-disk"
  type    = "pd-ssd"
  zone    = local.global.location
  size    = 300
  labels  = {
    "goog-gke-volume" = ""
  }
}