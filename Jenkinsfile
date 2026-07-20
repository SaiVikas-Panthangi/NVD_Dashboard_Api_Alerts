pipeline {
  agent any

  triggers {
    cron('H * * * *')
  }

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Verify Node Tooling') {
      steps {
        script {
          if (isUnix()) {
            sh '''
              command -v node >/dev/null 2>&1 || { echo "Node.js is not installed on this Jenkins agent."; exit 1; }
              command -v npm >/dev/null 2>&1 || { echo "npm is not installed on this Jenkins agent."; exit 1; }
              node --version
              npm --version
            '''
          } else {
            bat '''
              where node || (echo Node.js is not installed on this Jenkins agent. & exit /b 1)
              where npm || (echo npm is not installed on this Jenkins agent. & exit /b 1)
              node --version
              npm --version
            '''
          }
        }
      }
    }

    stage('Install Dependencies') {
      steps {
        script {
          if (isUnix()) {
            sh 'npm ci'
          } else {
            bat 'npm ci'
          }
        }
      }
    }

    stage('Run Monitor') {
      steps {
        withCredentials([string(credentialsId: 'teams-webhook-url', variable: 'TEAMS_WEBHOOK_URL')]) {
          script {
            if (isUnix()) {
              sh 'npm run monitor'
            } else {
              bat 'npm run monitor'
            }
          }
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'reports/**, logs/**, data/**', allowEmptyArchive: true
    }
  }
}