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

  environment {
    TEAMS_WEBHOOK_URL = credentials('inventory-endpoint-monitor-teams-webhook')
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Install Dependencies') {
      steps {
        script {
          if (isUnix()) {
            sh 'npm install'
          } else {
            bat 'npm install'
          }
        }
      }
    }

    stage('Run Monitor') {
      steps {
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

  post {
    always {
      archiveArtifacts artifacts: 'reports/**, logs/**, data/**', allowEmptyArchive: true
    }
  }
}
