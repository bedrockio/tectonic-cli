output "endpoint" {
  value = google_container_cluster.tectonic.endpoint
}

output "master_version" {
  value = google_container_cluster.tectonic.master_version
}

output "cli_connect" {
  value = "'gcloud container clusters get-credentials ${var.cluster_name} --zone ${var.region}-${var.zone} --project ${var.project}'"
}