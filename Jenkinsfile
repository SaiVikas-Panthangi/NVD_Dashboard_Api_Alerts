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