use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize)]
pub struct IpfsAddResult {
    pub name: String,
    pub hash: String,
    pub size: String,
}

pub struct IpfsClient {
    client: reqwest::Client,
    api_url: String,
}

impl IpfsClient {
    pub fn new(api_url: &str) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_url: api_url.trim_end_matches('/').to_string(),
        }
    }

    pub async fn add_file(&self, file_path: &PathBuf) -> Result<IpfsAddResult, String> {
        let file_bytes = tokio::fs::read(file_path).await.map_err(|e| e.to_string())?;
        let file_name = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file");

        let form = reqwest::multipart::Form::new().part(
            "file",
            reqwest::multipart::Part::bytes(file_bytes).file_name(file_name.to_string()),
        );

        let url = format!("{}/api/v0/add", self.api_url);
        let response = self
            .client
            .post(&url)
            .multipart(form)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let result: IpfsAddResult = response.json().await.map_err(|e| e.to_string())?;
        Ok(result)
    }

    pub async fn cat(&self, hash: &str) -> Result<Vec<u8>, String> {
        let url = format!("{}/api/v0/cat?arg={}", self.api_url, hash);
        let response = self
            .client
            .post(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        Ok(bytes.to_vec())
    }

    pub async fn pin(&self, hash: &str) -> Result<(), String> {
        let url = format!("{}/api/v0/pin/add?arg={}", self.api_url, hash);
        self.client
            .post(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn unpin(&self, hash: &str) -> Result<(), String> {
        let url = format!("{}/api/v0/pin/rm?arg={}", self.api_url, hash);
        self.client
            .post(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn ls_pins(&self) -> Result<Vec<String>, String> {
        let url = format!("{}/api/v0/pin/ls", self.api_url);
        let response = self
            .client
            .post(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        let keys = body["Keys"]
            .as_object()
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default();
        Ok(keys)
    }

    pub async fn is_online(&self) -> bool {
        let url = format!("{}/api/v0/id", self.api_url);
        self.client.post(&url).send().await.is_ok()
    }
}
