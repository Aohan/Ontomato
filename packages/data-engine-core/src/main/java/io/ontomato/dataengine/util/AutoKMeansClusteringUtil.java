package io.ontomato.dataengine.util;


import java.util.ArrayList;
import java.util.List;
import java.util.Random;

public class AutoKMeansClusteringUtil {
    private List<Point> points;
    private List<Cluster> clusters;
    private int bestK;
    private boolean algorithmFinished;

    public AutoKMeansClusteringUtil(List<Double> doubleList) {
        this.points = new ArrayList<>();
        for (int i = 0; i < doubleList.size(); i++) {
            Point point = new Point(doubleList.get(i), 0);
            this.points.add(point);
        }

        this.clusters = new ArrayList<>();
        this.algorithmFinished = false;

    }


    // Automatically determine the best K value and perform K-means clustering
    public void runAutoKMeans() {
        // Determine the range of K values (2 to √n)
        int maxK = (int) Math.min(Math.sqrt(points.size()), 10);
        double bestSilhouette = -1;
        int bestK = 2;
        List<Cluster> bestClusters = null;

        // If the dataset is too small, put everything into one cluster and return directly,
        if(maxK<2){
            Cluster cluster = new Cluster(0,points.get(0));
            points.get(0).setCluster( cluster);
            for(int i=0; i < points.size(); i++){
                cluster.addPoint(points.get(i));
                points.get(i).setCluster( cluster);
            }
            cluster.updateCenter();

            this.bestK = 1;
            bestClusters = new ArrayList<>();
            bestClusters.add( cluster);
            this.clusters=bestClusters;
            this.algorithmFinished = true;
            return;
        }

        // Try different K values
        for (int k = 2; k <= maxK; k++) {
            // Run K-means
            List<Cluster> currentClusters = runKMeans(k, 20);

            // Calculate the silhouette coefficient
            double silhouette = calculateSilhouetteCoefficient(currentClusters);
            System.out.println("K=" + k + " Silhouette Coefficient: " + silhouette);

            // Update the best K value
            if (silhouette > bestSilhouette) {
                bestSilhouette = silhouette;
                bestK = k;
                bestClusters = currentClusters;
            }
        }

        this.bestK = bestK;
        this.clusters = bestClusters;
        this.algorithmFinished = true;

        System.out.println("Best K: " + bestK + " with Silhouette Coefficient: " + bestSilhouette);

    }

    public double getHighClustersMinX() {
        double maxCenterX = 0;
        Cluster maxCluster = null;
        for (Cluster cluster : clusters){
            double centerX = cluster.getCenter().getX() ;
            if (centerX > maxCenterX) {
                maxCenterX = centerX;
                maxCluster = cluster;
            }
        }

        double minX = Double.MAX_VALUE;
        List<Point> maxClusterPoints = maxCluster.getPoints();
        for (Point point : maxClusterPoints){
            if (point.getX() < minX) {
                minX = point.getX();
            }
        }
        return minX;
    }

    // Execute the K-means algorithm
    private List<Cluster> runKMeans(int k, int maxIterations) {
        List<Cluster> clusters = new ArrayList<>();
        Random rand = new Random();

        int step = points.size()/(k+1);
        // Initialize the cluster centers
        for (int i = 0; i < k; i++) {
            Point center = points.get((i+1)* step);
            Cluster cluster = new Cluster(i, center);
            clusters.add(cluster);
        }

        boolean changed;
        int iteration = 0;

        do {
            changed = false;
            iteration++;

            // Clear the points of each cluster
            for (Cluster cluster : clusters) {
                cluster.clearPoints();
            }

            // Assign each point to the nearest cluster
            for (Point point : points) {
                Cluster nearestCluster = null;
                double minDistance = Double.MAX_VALUE;

                for (Cluster cluster : clusters) {
                    double distance = point.distanceTo(cluster.getCenter());
                    if (distance < minDistance) {
                        minDistance = distance;
                        nearestCluster = cluster;
                    }
                }

                if (nearestCluster != null) {
                    nearestCluster.addPoint(point);
                    if (point.getCluster() != nearestCluster) {
                        point.setCluster(nearestCluster);
                        changed = true;
                    }
                }
            }

            // Update the cluster centers
            for (Cluster cluster : clusters) {
                cluster.updateCenter();
            }
            if(iteration >= maxIterations){
                System.out.printf("iteration=%d\n",iteration);
            }
        } while (changed && iteration < maxIterations);

        return clusters;
    }

    // Calculate the silhouette coefficient
    private double calculateSilhouetteCoefficient(List<Cluster> clusters) {
        double totalSilhouette = 0;

        for (Point point : points) {
            Cluster ownCluster = point.getCluster();

            // Calculate a(i) - the average distance from point i to the other points in the same cluster
            double a = 0;
            List<Point> ownPoints = ownCluster.getPoints();
            for (Point other : ownPoints) {
                if (other != point) {
                    a += point.distanceTo(other);
                }
            }
            if(ownPoints.size()<=1){
                a=0;
            } else {
                a /= (ownPoints.size() - 1);
            }


            // Calculate b(i) - the minimum average distance from point i to all points in other clusters
            double b = Double.MAX_VALUE;
            for (Cluster otherCluster : clusters) {
                if (otherCluster != ownCluster) {
                    double otherAvg = 0;
                    List<Point> otherPoints = otherCluster.getPoints();
                    for (Point other : otherPoints) {
                        otherAvg += point.distanceTo(other);
                    }
                    otherAvg /= otherPoints.size();
                    if (otherAvg < b) {
                        b = otherAvg;
                    }
                }
            }

            // Calculate the silhouette coefficient of point i
            double s = (b - a) / Math.max(a, b);
            totalSilhouette += s;
        }

        return totalSilhouette / points.size();
    }



    // Data point class
    class Point {
        private double x;
        private double y;
        private Cluster cluster;

        public Point(double x, double y) {
            this.x = x;
            this.y = y;
        }

        public double getX() { return x; }
        public double getY() { return y; }
        public Cluster getCluster() { return cluster; }

        public void setX(double x) { this.x = x; }
        public void setY(double y) { this.y = y; }
        public void setCluster(Cluster cluster) { this.cluster = cluster; }

        public double distanceTo(Point other) {
            double dx = x - other.x;
            double dy = y - other.y;
            return Math.sqrt(dx * dx + dy * dy);
        }
    }

    // Cluster class
    class Cluster {
        private int id;
        private Point center;
        private List<Point> clusterPoints;


        public Cluster(int id, Point center) {
            this.id = id;
            this.center = new Point(center.getX(), center.getY());
            this.clusterPoints = new ArrayList<>();

        }

        public Point getCenter() { return center; }
        public List<Point> getPoints() { return this.clusterPoints; }


        public void addPoint(Point point) {
            this.clusterPoints.add(point);
        }

        public void clearPoints() {
            this.clusterPoints.clear();
        }

        // Update the cluster centers
        public void updateCenter() {
            if (this.clusterPoints.isEmpty()) return;

            double sumX = 0;
            double sumY = 0;

            for (Point point : this.clusterPoints) {
                sumX += point.getX();
                sumY += point.getY();
            }

            center.setX(sumX / this.clusterPoints.size());
            center.setY(sumY / this.clusterPoints.size());
        }
    }

}